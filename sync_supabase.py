#!/usr/bin/env python3
"""Apply pending migrations and deploy every Edge Function. Never logs in."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent

def environment():
    env = os.environ.copy()
    for filename in ('.env', '.env.local'):
        path = ROOT / filename
        if path.exists():
            for line in path.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    name, value = line.split('=', 1)
                    # The real process environment takes precedence over files.
                    if name.strip() not in os.environ:
                        env[name.strip()] = value.strip().strip('\"\'')
    return env

def commands(project_ref):
    cli = ['npx', '--yes', 'supabase@2']
    return [
        cli + ['link', '--project-ref', project_ref],
        cli + ['db', 'push', '--linked'],
        cli + ['functions', 'deploy', '--project-ref', project_ref],
    ]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-ref', help='Override SUPABASE_PROJECT_REF')
    parser.add_argument('--dry-run', action='store_true', help='Print the plan; execute nothing')
    args = parser.parse_args()
    env = environment()
    ref = args.project_ref or env.get('SUPABASE_PROJECT_REF', '')
    if not re.fullmatch(r'[a-z]{20}', ref):
        parser.error('Set a real 20-letter SUPABASE_PROJECT_REF in .env.local or pass --project-ref.')
    plan = commands(ref)
    if args.dry_run:
        for command in plan:
            print(' '.join(command))
        return 0
    if not shutil.which('npx'):
        parser.error('Install Node.js (including npx) first.')
    # Uses an existing CLI login or SUPABASE_ACCESS_TOKEN. This script never runs login.
    try:
        for command, label in zip(plan, ['Linking project', 'Applying pending migrations', 'Deploying all Edge Functions']):
            print(label + '…', flush=True)
            subprocess.run(command, cwd=ROOT, env=env, check=True)
    except subprocess.CalledProcessError as error:
        print(f'Sync stopped after a failed command (exit {error.returncode}).', file=sys.stderr)
        return error.returncode
    print('Supabase synced.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
