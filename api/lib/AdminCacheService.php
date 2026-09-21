<?php
/**
 * Admin Dashboard Caching Service
 * Provides simple file-based caching with TTL support
 * 
 * Usage:
 * $cache = new AdminCacheService();
 * $cache->set('key', $data, 3600); // Cache for 1 hour
 * $data = $cache->get('key');
 * $cache->delete('key');
 */

class AdminCacheService {
    const CACHE_DIR = __DIR__ . '/../../tmp/admin_cache/';
    const DEFAULT_TTL = 3600; // 1 hour
    
    /**
     * Initialize cache directory
     */
    public static function init() {
        if (!is_dir(self::CACHE_DIR)) {
            @mkdir(self::CACHE_DIR, 0755, true);
        }
    }
    
    /**
     * Get cached value
     * 
     * @param string $key
     * @return mixed|null
     */
    public static function get($key) {
        self::init();
        
        $cacheFile = self::getCacheFile($key);
        
        if (!file_exists($cacheFile)) {
            return null;
        }
        
        $data = json_decode(file_get_contents($cacheFile), true);
        
        if (!$data || !isset($data['expires_at'])) {
            @unlink($cacheFile);
            return null;
        }
        
        // Check if cache has expired
        if (time() > $data['expires_at']) {
            @unlink($cacheFile);
            return null;
        }
        
        return $data['value'] ?? null;
    }
    
    /**
     * Set cache value
     * 
     * @param string $key
     * @param mixed $value
     * @param int $ttl Time to live in seconds
     * @return bool
     */
    public static function set($key, $value, $ttl = self::DEFAULT_TTL) {
        self::init();
        
        $cacheFile = self::getCacheFile($key);
        $data = [
            'value' => $value,
            'created_at' => time(),
            'expires_at' => time() + $ttl,
            'key' => $key
        ];
        
        $result = file_put_contents(
            $cacheFile,
            json_encode($data),
            LOCK_EX
        );
        
        return $result !== false;
    }
    
    /**
     * Delete cache value
     * 
     * @param string $key
     * @return bool
     */
    public static function delete($key) {
        self::init();
        
        $cacheFile = self::getCacheFile($key);
        
        if (file_exists($cacheFile)) {
            return @unlink($cacheFile);
        }
        
        return true;
    }
    
    /**
     * Clear all cache
     * 
     * @param string|null $pattern Optional pattern to match keys (e.g., 'dashboard_*')
     * @return int Number of files deleted
     */
    public static function clear($pattern = null) {
        self::init();
        
        $count = 0;
        $files = glob(self::CACHE_DIR . '*.cache');
        
        foreach ($files as $file) {
            if ($pattern) {
                $key = basename($file, '.cache');
                if (!fnmatch($pattern, $key)) {
                    continue;
                }
            }
            
            if (@unlink($file)) {
                $count++;
            }
        }
        
        return $count;
    }
    
    /**
     * Get cache statistics
     * 
     * @return array
     */
    public static function getStats() {
        self::init();
        
        $stats = [
            'total_files' => 0,
            'total_size' => 0,
            'expired_files' => 0,
            'cache_entries' => []
        ];
        
        $files = glob(self::CACHE_DIR . '*.cache');
        
        foreach ($files as $file) {
            $stats['total_files']++;
            $stats['total_size'] += filesize($file);
            
            $data = json_decode(file_get_contents($file), true);
            
            if ($data && isset($data['expires_at']) && time() > $data['expires_at']) {
                $stats['expired_files']++;
            }
            
            if ($data) {
                $stats['cache_entries'][] = [
                    'key' => $data['key'] ?? basename($file),
                    'created_at' => $data['created_at'] ?? null,
                    'expires_at' => $data['expires_at'] ?? null,
                    'size' => filesize($file),
                    'expired' => isset($data['expires_at']) && time() > $data['expires_at']
                ];
            }
        }
        
        return $stats;
    }
    
    /**
     * Get cache file path
     * 
     * @param string $key
     * @return string
     */
    private static function getCacheFile($key) {
        // Sanitize key
        $key = preg_replace('/[^a-zA-Z0-9_-]/', '_', $key);
        return self::CACHE_DIR . $key . '.cache';
    }
    
    /**
     * Cleanup expired cache files
     * 
     * @return int Number of files deleted
     */
    public static function cleanup() {
        self::init();
        
        $count = 0;
        $files = glob(self::CACHE_DIR . '*.cache');
        
        foreach ($files as $file) {
            $data = json_decode(file_get_contents($file), true);
            
            if ($data && isset($data['expires_at']) && time() > $data['expires_at']) {
                if (@unlink($file)) {
                    $count++;
                }
            }
        }
        
        return $count;
    }
}

// Initialize cache directory on include
AdminCacheService::init();
?>
