-- Day 2 hardening: every SECURITY DEFINER function in public runs with a fixed
-- search_path (pg_catalog first, then public; no pg_temp) and is executable only
-- by app_user (and its owner). New functions don't get EXECUTE for PUBLIC by default.

DO $$
DECLARE
  f regprocedure;
  has_app_user boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user');
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM app_admin', f);
    END IF;
    IF has_app_user THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_user', f);
    END IF;
  END LOOP;
END
$$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
