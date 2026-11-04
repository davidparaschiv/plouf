import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('sync_supabase', Path(__file__).resolve().parents[1] / 'sync_supabase.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SyncPlanTests(unittest.TestCase):
    def test_sync_plan_never_logs_in_or_resets(self):
        commands = module.commands('abcdefghijklmnopqrst')
        self.assertEqual(len(commands), 3)
        self.assertEqual(commands[0][3:5], ['link', '--project-ref'])
        self.assertEqual(commands[1][3:], ['db', 'push', '--linked'])
        self.assertEqual(commands[2][3:], ['functions', 'deploy', '--project-ref', 'abcdefghijklmnopqrst'])
        self.assertNotIn('login', [arg for command in commands for arg in command])
        self.assertNotIn('reset', [arg for command in commands for arg in command])

if __name__ == '__main__':
    unittest.main()
