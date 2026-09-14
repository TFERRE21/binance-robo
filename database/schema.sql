-- ============================================================
-- BINANCE-ROBO / CRIPTOPRO
-- Banco de dados do painel multiusuário
-- PostgreSQL
-- ============================================================


-- ============================================================
-- 1. USUÁRIOS
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(100) NOT NULL,

    email VARCHAR(255) NOT NULL UNIQUE,

    password_hash TEXT NOT NULL,

    active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 2. CONTAS BINANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS binance_accounts (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,

    name VARCHAR(100) NOT NULL DEFAULT 'Minha conta Binance',

    api_key_encrypted TEXT NOT NULL,

    api_secret_encrypted TEXT NOT NULL,

    active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_binance_accounts_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


-- ============================================================
-- 3. CONFIGURAÇÕES DO ROBÔ
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_configs (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL UNIQUE,

    enabled BOOLEAN NOT NULL DEFAULT FALSE,

    take_profit NUMERIC(10,4) NOT NULL DEFAULT 5.0000,

    stop_loss NUMERIC(10,4) NOT NULL DEFAULT 0.0000,

    score_minimum INTEGER NOT NULL DEFAULT 7,

    entry_percentage NUMERIC(10,4) NOT NULL DEFAULT 98.0000,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_bot_configs_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


-- ============================================================
-- 4. OPERAÇÕES
-- ============================================================

CREATE TABLE IF NOT EXISTS trades (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,

    binance_account_id BIGINT,

    symbol VARCHAR(30) NOT NULL,

    side VARCHAR(10) NOT NULL,

    entry_price NUMERIC(30,12),

    exit_price NUMERIC(30,12),

    quantity NUMERIC(30,12),

    profit NUMERIC(30,12),

    fee NUMERIC(30,12) DEFAULT 0,

    order_id VARCHAR(100),

    status VARCHAR(30) NOT NULL DEFAULT 'OPEN',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    closed_at TIMESTAMPTZ,

    CONSTRAINT fk_trades_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_trades_binance_account
        FOREIGN KEY (binance_account_id)
        REFERENCES binance_accounts(id)
        ON DELETE SET NULL
);


-- ============================================================
-- 5. LOGS DO ROBÔ
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_logs (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,

    level VARCHAR(20) NOT NULL DEFAULT 'INFO',

    message TEXT NOT NULL,

    symbol VARCHAR(30),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_bot_logs_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


-- ============================================================
-- 6. ÍNDICES EXISTENTES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_binance_accounts_user_id
    ON binance_accounts(user_id);


CREATE INDEX IF NOT EXISTS idx_trades_user_id
    ON trades(user_id);


CREATE INDEX IF NOT EXISTS idx_trades_symbol
    ON trades(symbol);


CREATE INDEX IF NOT EXISTS idx_trades_created_at
    ON trades(created_at);


CREATE INDEX IF NOT EXISTS idx_bot_logs_user_id
    ON bot_logs(user_id);


CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at
    ON bot_logs(created_at);


-- ============================================================
-- 7. ASSINATURAS / PLANOS DO CRIPTOPRO
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (

    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,

    plan VARCHAR(30) NOT NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',

    amount NUMERIC(10,2) NOT NULL,

    payment_provider VARCHAR(50),

    external_payment_id VARCHAR(255),

    external_subscription_id VARCHAR(255),

    payment_method VARCHAR(50),

    started_at TIMESTAMPTZ,

    expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_subscriptions_user

        FOREIGN KEY (user_id)

        REFERENCES users(id)

        ON DELETE CASCADE,

    CONSTRAINT chk_subscription_plan

        CHECK (
            plan IN (
                'basico',
                'profissional',
                'premium'
            )
        ),

    CONSTRAINT chk_subscription_status

        CHECK (
            status IN (
                'PENDING',
                'ACTIVE',
                'EXPIRED',
                'CANCELLED'
            )
        )

);


-- ============================================================
-- 8. ÍNDICES DAS ASSINATURAS
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id

    ON subscriptions(user_id);


CREATE INDEX IF NOT EXISTS idx_subscriptions_status

    ON subscriptions(status);


CREATE INDEX IF NOT EXISTS idx_subscriptions_plan

    ON subscriptions(plan);


CREATE INDEX IF NOT EXISTS idx_subscriptions_external_payment

    ON subscriptions(external_payment_id);


CREATE INDEX IF NOT EXISTS idx_subscriptions_external_subscription

    ON subscriptions(external_subscription_id);


CREATE INDEX IF NOT EXISTS idx_subscriptions_expires_at

    ON subscriptions(expires_at);


-- ============================================================
-- 9. UMA ASSINATURA ATIVA POR USUÁRIO
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS
idx_one_active_subscription_per_user

ON subscriptions(user_id)

WHERE status = 'ACTIVE';


-- ============================================================
-- 10. FIM
-- ============================================================
