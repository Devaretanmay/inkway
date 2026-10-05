-- Restore the previous setting namespace for databases rolling back the app.
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
          AND p.prosrc ~ 'inkway\.(actor_type|actor_id|source_task_id)'
    LOOP
        EXECUTE replace(fn.definition, 'inkway.', 'multica.');
        replaced := replaced + 1;
    END LOOP;

    IF replaced = 0 THEN
        RAISE EXCEPTION 'no active wakeup trigger functions found with Inkway settings';
    END IF;
END
$$;
