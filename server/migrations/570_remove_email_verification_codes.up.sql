-- One-time login codes are obsolete in the local-first product. They contain
-- short-lived authentication material only; issue/agent/workspace data is not
-- touched.
DROP TABLE IF EXISTS verification_code;
