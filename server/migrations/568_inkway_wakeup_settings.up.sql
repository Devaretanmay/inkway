-- Keep the active wakeup triggers aligned with the application-owned GUC
-- namespace. Earlier migrations are immutable; replace only live functions
-- whose source still reads the retired setting prefix.
DO $$
DECLARE
    fn record;
    replaced integer := 0;
BEGIN
    FOR fn IN
        SELECT p.oid, pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosrc ~ 'multica\.(actor_type|actor_id|source_task_id)'
    LOOP
        EXECUTE replace(fn.definition, 'multica.', 'inkway.');
        replaced := replaced + 1;
    END LOOP;

    IF replaced = 0 THEN
        RAISE EXCEPTION 'no active wakeup trigger functions found with legacy settings';
    END IF;
END
$$;
