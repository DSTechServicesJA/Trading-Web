//+------------------------------------------------------------------+
//|                                             ITGuruMt5Bridge.mq5  |
//| Drop-in skeleton: OnInit/OnTimer/WebRequest/OrderSend/status     |
//+------------------------------------------------------------------+
#property strict

input string InpBaseUrl        = "https://trading.dsitservicesja.com/indicator"; // no trailing slash preferred
input string InpBridgeKey      = "c95e6fcd65bd378d679f6bed5b0cc51d6f9d6d5832dc1379c475ed17d4ffd1a5";
input string InpTerminalId     = "MT5-TERM-01";
input int    InpPollSeconds    = 2;
input int    InpHttpTimeoutMs  = 5000;
input int    InpDeviationPts   = 20;
input long   InpMagic          = 26051701;
input bool   InpOnlyChartSymbol= false; // true = skip orders not matching current chart symbol

struct BridgeOrder
{
   string orderId;
   string symbol;
   string side;
   string orderType;
   double entry;
   double sl;
   double tp;
   double lot;
};

//-------------------- Utilities --------------------

string TrimSlash(string s)
{
   int n=StringLen(s);
   while(n>0 && StringGetCharacter(s,n-1)=='/')
   {
      s=StringSubstr(s,0,n-1);
      n=StringLen(s);
   }
   return s;
}

string JsonEscape(string s)
{
   s = StringReplace(s, "\\", "\\\\");
   s = StringReplace(s, "\"", "\\\"");
   s = StringReplace(s, "\r", "\\r");
   s = StringReplace(s, "\n", "\\n");
   s = StringReplace(s, "\t", "\\t");
   return s;
}

bool HttpRequest(string method, string url, string headers, string body, string &resp, string &respHeaders, int &statusCode)
{
   char data[];
   if(method=="POST")
      StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   else
      ArrayResize(data, 0);

   char result[];
   ResetLastError();
   statusCode = WebRequest(method, url, headers, InpHttpTimeoutMs, data, result, respHeaders);
   if(statusCode == -1)
   {
      Print("WebRequest failed. err=", GetLastError(), " url=", url);
      return false;
   }
   resp = CharArrayToString(result, 0, -1, CP_UTF8);
   return true;
}

// Very minimal JSON extractors (sufficient for this endpoint shape)
string JsonGetString(string obj, string key)
{
   string k="\""+key+"\"";
   int p=StringFind(obj,k);
   if(p<0) return "";
   p=StringFind(obj,":",p);
   if(p<0) return "";
   p++;
   while(p<StringLen(obj) && (StringGetCharacter(obj,p)==' ' || StringGetCharacter(obj,p)=='\n' || StringGetCharacter(obj,p)=='\r' || StringGetCharacter(obj,p)=='\t')) p++;
   if(p>=StringLen(obj) || StringGetCharacter(obj,p)!='"') return "";
   p++;
   int q=p;
   while(q<StringLen(obj))
   {
      int c=StringGetCharacter(obj,q);
      if(c=='"' && StringGetCharacter(obj,q-1)!='\\') break;
      q++;
   }
   if(q<=p) return "";
   return StringSubstr(obj,p,q-p);
}

double JsonGetNumber(string obj, string key, double def=0.0)
{
   string k="\""+key+"\"";
   int p=StringFind(obj,k);
   if(p<0) return def;
   p=StringFind(obj,":",p);
   if(p<0) return def;
   p++;
   while(p<StringLen(obj) && (StringGetCharacter(obj,p)==' ' || StringGetCharacter(obj,p)=='\n' || StringGetCharacter(obj,p)=='\r' || StringGetCharacter(obj,p)=='\t')) p++;
   int q=p;
   while(q<StringLen(obj))
   {
      int c=StringGetCharacter(obj,q);
      if(!((c>='0'&&c<='9') || c=='-' || c=='+' || c=='.' || c=='e' || c=='E')) break;
      q++;
   }
   if(q<=p) return def;
   return StringToDouble(StringSubstr(obj,p,q-p));
}

int JsonGetInt(string obj, string key, int def=0)
{
   return (int)MathRound(JsonGetNumber(obj,key,def));
}

bool ExtractOrdersArray(string json, string &ordersArray)
{
   int p=StringFind(json,"\"orders\"");
   if(p<0) return false;
   p=StringFind(json,"[",p);
   if(p<0) return false;

   int depth=0, q=p;
   for(; q<StringLen(json); q++)
   {
      int c=StringGetCharacter(json,q);
      if(c=='[') depth++;
      else if(c==']')
      {
         depth--;
         if(depth==0) break;
      }
   }
   if(q<=p) return false;
   ordersArray = StringSubstr(json,p+1,q-p-1); // content inside [...]
   return true;
}

int ParseOrders(string json, BridgeOrder &out[])
{
   ArrayResize(out,0);

   int count=JsonGetInt(json,"count",0);
   if(count<=0) return 0;

   string arr;
   if(!ExtractOrdersArray(json,arr)) return 0;

   int i=0, n=StringLen(arr);
   while(i<n)
   {
      while(i<n && StringGetCharacter(arr,i)!='{') i++;
      if(i>=n) break;

      int start=i, depth=0;
      for(; i<n; i++)
      {
         int c=StringGetCharacter(arr,i);
         if(c=='{') depth++;
         else if(c=='}')
         {
            depth--;
            if(depth==0) break;
         }
      }
      if(i>=n) break;

      string obj = StringSubstr(arr,start,i-start+1);
      BridgeOrder o;
      o.orderId   = JsonGetString(obj,"orderId");
      o.symbol    = JsonGetString(obj,"symbol");
      o.side      = JsonGetString(obj,"side");
      o.orderType = JsonGetString(obj,"orderType");
      o.entry     = JsonGetNumber(obj,"entry",0.0);
      o.sl        = JsonGetNumber(obj,"sl",0.0);
      o.tp        = JsonGetNumber(obj,"tp",0.0);
      o.lot       = JsonGetNumber(obj,"lot",0.01);

      if(o.orderId!="" && o.symbol!="" && o.orderType!="" && o.lot>0)
      {
         int sz=ArraySize(out);
         ArrayResize(out,sz+1);
         out[sz]=o;
      }
      i++;
   }

   return ArraySize(out);
}

//-------------------- Bridge callbacks --------------------

void PostStatus(string orderId, string status, string brokerTicket, string message, double filledPrice=0.0)
{
   string base = TrimSlash(InpBaseUrl);
   string url  = base + "/api/mt5/status.php";
   string headers =
      "Content-Type: application/json\r\n"
      "X-MT5-BRIDGE-KEY: " + InpBridgeKey + "\r\n";

   string body = "{"
      "\"bridge_key\":\""+JsonEscape(InpBridgeKey)+"\","
      "\"orderId\":\""+JsonEscape(orderId)+"\","
      "\"status\":\""+JsonEscape(status)+"\","
      "\"brokerTicket\":\""+JsonEscape(brokerTicket)+"\","
      "\"message\":\""+JsonEscape(message)+"\","
      "\"filledPrice\":"+DoubleToString(filledPrice,_Digits)
      "}";

   string resp, respHeaders;
   int code=-1;
   if(!HttpRequest("POST",url,headers,body,resp,respHeaders,code))
      return;

   if(code!=200)
      Print("status.php HTTP ",code," body=",resp);
}

bool SendTrade(const BridgeOrder &o)
{
   if(InpOnlyChartSymbol && o.symbol != _Symbol)
      return false;

   if(!SymbolSelect(o.symbol,true))
   {
      PostStatus(o.orderId,"REJECTED","", "SymbolSelect failed: "+o.symbol, 0.0);
      return false;
   }

   MqlTick tick;
   if(!SymbolInfoTick(o.symbol,tick))
   {
      PostStatus(o.orderId,"REJECTED","", "SymbolInfoTick failed: "+o.symbol, 0.0);
      return false;
   }

   MqlTradeRequest req;
   MqlTradeResult  res;
   ZeroMemory(req);
   ZeroMemory(res);

   req.magic      = InpMagic;
   req.symbol     = o.symbol;
   req.volume     = o.lot;
   req.deviation  = InpDeviationPts;
   req.comment    = o.orderId;
   req.sl         = o.sl;
   req.tp         = o.tp;

   string ot = o.orderType;

   if(ot=="BUY_MARKET" || ot=="SELL_MARKET")
   {
      req.action = TRADE_ACTION_DEAL;
      req.type   = (ot=="BUY_MARKET" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
      req.price  = (req.type==ORDER_TYPE_BUY ? tick.ask : tick.bid);
      req.type_filling = ORDER_FILLING_FOK;
   }
   else
   {
      req.action = TRADE_ACTION_PENDING;
      if(ot=="BUY_LIMIT")      req.type = ORDER_TYPE_BUY_LIMIT;
      else if(ot=="SELL_LIMIT")req.type = ORDER_TYPE_SELL_LIMIT;
      else if(ot=="BUY_STOP")  req.type = ORDER_TYPE_BUY_STOP;
      else if(ot=="SELL_STOP") req.type = ORDER_TYPE_SELL_STOP;
      else
      {
         PostStatus(o.orderId,"REJECTED","", "Unknown orderType: "+ot, 0.0);
         return false;
      }
      req.price       = o.entry;
      req.type_time   = ORDER_TIME_GTC;
      req.type_filling= ORDER_FILLING_RETURN;
   }

   // Tell backend we received/processing (optional but useful)
   PostStatus(o.orderId,"RECEIVED","", "EA accepted order for processing", 0.0);

   bool ok = OrderSend(req,res);
   string ticket = (string)((res.order>0)?res.order:res.deal);

   if(!ok)
   {
      PostStatus(o.orderId,"REJECTED",ticket,
                 "OrderSend failed retcode="+(string)res.retcode+" comment="+res.comment,0.0);
      return false;
   }

   // Map result -> status.php
   if(res.retcode==TRADE_RETCODE_DONE || res.retcode==TRADE_RETCODE_DONE_PARTIAL)
   {
      PostStatus(o.orderId,"FILLED",ticket,
                 "Executed retcode="+(string)res.retcode+" comment="+res.comment,res.price);
   }
   else if(res.retcode==TRADE_RETCODE_PLACED)
   {
      // Pending accepted by broker
      PostStatus(o.orderId,"RECEIVED",ticket,
                 "Pending placed retcode="+(string)res.retcode+" comment="+res.comment,0.0);
   }
   else
   {
      PostStatus(o.orderId,"REJECTED",ticket,
                 "Broker reject retcode="+(string)res.retcode+" comment="+res.comment,0.0);
      return false;
   }

   return true;
}

void PollAndExecute()
{
   string base = TrimSlash(InpBaseUrl);
   string url  = base + "/api/mt5/pull.php?limit=20&terminal=" + InpTerminalId;
   string headers =
      "X-MT5-BRIDGE-KEY: " + InpBridgeKey + "\r\n"
      "Content-Type: application/json\r\n";

   string resp, respHeaders;
   int code=-1;
   if(!HttpRequest("GET",url,headers,"",resp,respHeaders,code))
      return;

   if(code!=200)
   {
      Print("pull.php HTTP ",code," body=",resp);
      return;
   }

   BridgeOrder orders[];
   int n = ParseOrders(resp, orders);
   if(n<=0) return;

   for(int i=0;i<n;i++)
      SendTrade(orders[i]);
}

//-------------------- EA lifecycle --------------------

int OnInit()
{
   if(InpBridgeKey=="CHANGE_ME" || StringLen(InpBridgeKey)<8)
      Print("WARNING: Set InpBridgeKey.");

   EventSetTimer(MathMax(1,InpPollSeconds));

   Print("ITGuru MT5 Bridge started. Base=",TrimSlash(InpBaseUrl),
         " TerminalId=",InpTerminalId,
         ". Add URL in MT5: Tools > Options > Expert Advisors > Allow WebRequest.");
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   PollAndExecute();
}