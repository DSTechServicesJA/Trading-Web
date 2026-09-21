<?php
declare(strict_types=1);

require_once __DIR__ . '/../config.php';

final class Database
{
    private static ?self $instance = null;
    private PDO $connection;

    private function __construct()
    {
        $this->connection = getDB();
    }

    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    public function getConnection(): PDO
    {
        return $this->connection;
    }

    public function fetchOne(string $sql, array $params = []): array
    {
        $stmt = $this->prepareAndExecute($sql, $params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return is_array($row) ? $row : [];
    }

    public function fetchAll(string $sql, array $params = []): array
    {
        $stmt = $this->prepareAndExecute($sql, $params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        return is_array($rows) ? $rows : [];
    }

    public function execute(string $sql, array $params = []): bool
    {
        $stmt = $this->prepareAndExecute($sql, $params);
        return $stmt->rowCount() >= 0;
    }

    public function lastInsertId(): string
    {
        return $this->connection->lastInsertId();
    }

    private function prepareAndExecute(string $sql, array $params): PDOStatement
    {
        $stmt = $this->connection->prepare($sql);
        foreach ($params as $key => $value) {
            $keyText = (string) $key;
            $paramKey = is_int($key) ? $key + 1 : ((strpos($keyText, ':') === 0) ? $keyText : ':' . $keyText);
            $type = PDO::PARAM_STR;
            if ($value === null) {
                $type = PDO::PARAM_NULL;
            } elseif (is_int($value)) {
                $type = PDO::PARAM_INT;
            } elseif (is_bool($value)) {
                $type = PDO::PARAM_BOOL;
            }
            $stmt->bindValue($paramKey, $value, $type);
        }
        $stmt->execute();

        return $stmt;
    }
}
