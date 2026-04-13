# D&S IT Services Limited Price Calculator

## System Overview
This estimate system calculates the final retail price (JMD) for products sourced from international vendors (Amazon, eBay, etc.), including all applicable taxes, duties, and profit margins.

---

## System Parameters

### Exchange & Customs Settings
| Parameter | Value |
|-----------|-------|
| USD Exchange Rate | $158.66 JMD/USD |
| Estimated Customs % | 0.35 (35%) |
| Customs USD Threshold | $100.00 USD |

### Profit & Tax Configuration
| Component | Rate |
|-----------|------|
| Profit Margin | 40% |
| Vendor Tax (GCT) | 15% |
| Additional Tax | 0.15% |

---

## Calculation Breakdown

### Formula Components
1. **JMD Price** = Original Price (USD) × Exchange Rate
2. **Profit (40%)** = JMD Price × 0.40
3. **Vendor Tax (15%)** = (JMD Price + Profit) × 0.15
4. **GCT (0.15%)** = (JMD Price + Profit + Vendor Tax) × 0.0015
5. **Total (JMD)** = JMD Price + Profit + Vendor Tax + GCT
6. **Customs** = Applied if Original Price USD > $100.00 threshold
7. **Final Balance** = Total (JMD) + Customs (if applicable)
8. **Final USD Cost** = Final Balance ÷ Exchange Rate

---

## Pricing Examples

### Example 1: Item - $70.00 USD
| Field | Value |
|-------|-------|
| Original Price (USD) | $70.00 |
| JMD Price | $11,106.20 |
| Profit (40%) | $4,442.48 |
| Vendor Tax (15%) | $1,665.93 |
| GCT (0.15%) | $2,582.19 |
| **Total (JMD)** | **$17,214.61** |
| Customs Status | Under Threshold (No Customs) |
| **Final Balance (JMD)** | **$19,796.80** |
| Final USD Cost | $108.50 |

### Example 2: Item - $152.00 USD
| Field | Value |
|-------|-------|
| Original Price (USD) | $152.00 |
| JMD Price | $24,116.32 |
| Profit (40%) | $9,646.53 |
| Vendor Tax (15%) | $3,617.45 |
| GCT (0.15%) | $5,607.04 |
| Subtotal (JMD) | $37,380.30 |
| **Customs (35%)** | **$8,440.71** |
| **Final Balance (JMD)** | **$42,987.34** |
| Final USD Cost | $235.60 |
| Weight (lbs) | 16,881.42 |

### Example 3: Item - $30.00 USD
| Field | Value |
|-------|-------|
| Original Price (USD) | $30.00 |
| JMD Price | $4,759.80 |
| Profit (40%) | $1,903.92 |
| Vendor Tax (15%) | $713.97 |
| GCT (0.15%) | $1,106.65 |
| **Total (JMD)** | **$7,377.69** |
| Customs Status | Under Threshold (No Customs) |
| **Final Balance (JMD)** | **$8,484.34** |
| Final USD Cost | $46.50 |

---

## Key Business Rules

### Customs Calculation
- **Threshold**: Items with Original Price (USD) ≤ $100.00 are exempt from customs
- **Rate**: Customs charged at 35% of Subtotal (JMD) for items exceeding $100.00 USD
- **Application**: Customs are added to the Subtotal (JMD) to calculate Final Balance

### Tax Structure
1. Vendor Tax (GCT): 15% applied after profit calculation
2. Additional Tax: 0.15% applied after vendor tax
3. Customs: 35% applied to eligible items (when USD price > $100.00)

### Final Pricing
- All calculations in JMD currency
- Final Balance represents total cost to import product
- USD conversion provided for reference using current exchange rate

---

## Usage Notes

- Update the **USD Exchange Rate** monthly based on current rates
- **Customs %** may vary; verify with Jamaican customs authority
- **Profit Margin** (40%) and **Tax Rates** (15%, 0.15%) are configurable per business policy
- Weight field (lbs) is used for shipping cost calculations (separate system)
- All prices rounded to nearest cent (JMD)

