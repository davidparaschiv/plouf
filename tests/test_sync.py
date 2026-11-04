import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sync_supabase', Path(__file__).resolve().parents[1] / 'sync_supabase.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
REF = 'abcdefghijklmnopqrst'


class SyncTests(unittest.TestCase):
    def test_only_named_environment_token_is_used(self):
        with patch.dict(os.environ, {'PLOUF_SECRET_SUPABASE': 'sbp_test', 'SUPABASE_ACCESS_TOKEN': 'wrong'}, clear=True):
            self.assertEqual(module.deployment_token(), 'sbp_test')
        with patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN': 'sbp_other'}, clear=True):
            with self.assertRaises(ValueError):
                module.deployment_token()

    def test_rejects_project_api_keys_without_exposing_value(self):
        for key in ['sb_secret_PRIVATE', 'sb_publishable_PUBLIC', 'eyJLEGACY']:
            with patch.dict(os.environ, {'PLOUF_SECRET_SUPABASE': key}, clear=True):
                with self.assertRaises(ValueError) as error:
                    module.deployment_token()
                self.assertNotIn(key, str(error.exception))

    def test_cli_only_deploys_functions_without_login_link_or_password(self):
        self.assertEqual(module.commands(REF), [['npx', '--yes', 'supabase@2', 'functions', 'deploy', '--project-ref', REF, '--use-api']])

    def test_existing_versions_and_api_names_are_skipped(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            migrations = root / 'supabase' / 'migrations'
            migrations.mkdir(parents=True)
            for filename in ['100_first.sql', '200_second.sql', '300_third.sql']:
                (migrations / filename).write_text('select 1;')
            history = [{'version': '100', 'name': 'first'}, {'version': '999', 'name': '200_second'}]
            with patch.object(module, 'management_request', side_effect=[history, None]) as request:
                module.sync_migrations(REF, 'test-token', root)
                self.assertEqual(request.call_count, 2)
                call = request.call_args
                self.assertEqual(call.args[2], 'POST')
                self.assertEqual(call.args[3], {'name': '300_third', 'query': 'select 1;'})
                self.assertIn('300_third', call.kwargs['idempotency_key'])

    def test_failure_stops_before_later_migrations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            migrations = root / 'supabase' / 'migrations'
            migrations.mkdir(parents=True)
            for filename in ['100_first.sql', '200_second.sql']:
                (migrations / filename).write_text('select 1;')
            with patch.object(module, 'management_request', side_effect=[[], RuntimeError('Failed')]) as request:
                with self.assertRaises(RuntimeError):
                    module.sync_migrations(REF, 'test-token', root)
                self.assertEqual(request.call_count, 2)

    def test_dry_run_does_not_read_token_contact_supabase_or_run_commands(self):
        with patch('sys.argv', ['sync_supabase.py', '--project-ref', REF, '--dry-run']), \
             patch.object(module, 'management_request') as request, \
             patch.object(module, 'deployment_token') as token, \
             patch.object(module.subprocess, 'run') as run:
            self.assertEqual(module.main(), 0)
            request.assert_not_called()
            token.assert_not_called()
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
