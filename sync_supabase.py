#!/usr/bin/env python3
"""Sync migrations and Edge Functions using one deployment token; never log in."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
TOKEN_VARIABLE = 'PLOUF_SECRET_SUPABASE'


def environment():
    env = os.environ.copy()
    for filename in ('.env', '.env.local'):
        path = ROOT / filename
        if path.exists():
            for line in path.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    name, value = line.split('=', 1)
                    if name.strip() not in os.environ:
                        env[name.strip()] = value.strip().strip('\"\'')
    return env


def deployment_token():
    # Read the credential from the process environment only, never from a file.
    token = os.environ.get(TOKEN_VARIABLE, '').strip()
    if not token:
        raise ValueError(f'Set {TOKEN_VARIABLE} to a Supabase personal access token.')
    if token.startswith(('sb_secret_', 'sb_publishable_', 'eyJ')):
        raise ValueError(
            f'{TOKEN_VARIABLE} must contain a personal access token from '
            'https://supabase.com/dashboard/account/tokens. Project API keys '
            '(including sb_secret_) cannot apply migrations or deploy functions.'
        )
    return token


def commands(project_ref):
    # --use-api avoids a local Docker requirement for function bundling.
    return [['npx', '--yes', 'supabase@2', 'functions', 'deploy',
             '--project-ref', project_ref, '--use-api']]


def migration_files(root=ROOT):
    result = []
    seen = set()
    for path in sorted((root / 'supabase' / 'migrations').glob('*.sql')):
        match = re.fullmatch(r'(\d+)_(.+)\.sql', path.name)
        if not match:
            raise ValueError(f'Invalid migration filename: {path.name}')
        version, name = match.groups()
        if version in seen:
            raise ValueError(f'Duplicate migration version: {version}')
        seen.add(version)
        result.append((path, version, name))
    return result


def management_request(project_ref, token, method, payload=None, idempotency_key=None):
    url = f'https://api.supabase.com/v1/projects/{project_ref}/database/migrations'
    headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/json'}
    if idempotency_key:
        headers['Idempotency-Key'] = idempotency_key
    body = None
    if payload is not None:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(payload).encode('utf-8')
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=180) as response:
            data = response.read()
            return json.loads(data) if data else None
    except HTTPError as error:
        # Do not print request headers, tokens, or SQL from server error bodies.
        hint = {401: 'Check the personal access token.',
                403: 'Check the token permissions for this project.',
                429: 'Rate limit reached; wait before trying again.'}.get(
                    error.code, 'Check the migration and project logs before retrying.')
        raise RuntimeError(f'Migration API returned HTTP {error.code}. {hint}') from None
    except (URLError, TimeoutError):
        raise RuntimeError(
            'The migration request could not complete. Check the remote migration '
            'history before retrying; the operation may have reached Supabase.'
        ) from None


def sync_migrations(project_ref, token, root=ROOT):
    files = migration_files(root)
    if not files:
        print('No local migrations.')
        return
    history = management_request(project_ref, token, 'GET')
    if not isinstance(history, list) or any(not isinstance(item, dict) for item in history):
        raise RuntimeError('Unexpected migration history response; sync stopped.')
    versions = {str(item.get('version', '')) for item in history}
    names = {item.get('name') for item in history}
    for path, version, _name in files:
        # Existing CLI migrations match by version. API migrations match by full
        # local filename stem, since the API assigns its own remote timestamps.
        if version in versions or path.stem in names:
            print(f'Already applied: {path.name}')
            continue
        print(f'Applying {path.name}…', flush=True)
        management_request(project_ref, token, 'POST',
                           {'name': path.stem, 'query': path.read_text(encoding='utf-8')},
                           idempotency_key=f'plouf-{project_ref}-{path.stem}')
        names.add(path.stem)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-ref', help='Override SUPABASE_PROJECT_REF')
    parser.add_argument('--dry-run', action='store_true', help='Show local plan; no requests or commands')
    args = parser.parse_args()
    env = environment()
    ref = args.project_ref or env.get('SUPABASE_PROJECT_REF', '')
    if not re.fullmatch(r'[a-z]{20}', ref):
        parser.error('Set a real 20-letter SUPABASE_PROJECT_REF or pass --project-ref.')
    try:
        files = migration_files()
        if args.dry_run:
            for path, _, _ in files:
                print(f'Check/apply through Management API: {path.name}')
            for command in commands(ref):
                print(' '.join(command))
            return 0
        token = deployment_token()
        if not shutil.which('npx'):
            raise ValueError('Install Node.js (including npx) first.')
        child_env = env.copy()
        child_env['SUPABASE_ACCESS_TOKEN'] = token
        child_env.pop('SUPABASE_DB_PASSWORD', None)
        sync_migrations(ref, token)
        print('Deploying all Edge Functions…', flush=True)
        for command in commands(ref):
            subprocess.run(command, cwd=ROOT, env=child_env, check=True)
    except (ValueError, RuntimeError, OSError) as error:
        print(f'Sync stopped: {error}', file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as error:
        print(f'Function deployment failed (exit {error.returncode}).', file=sys.stderr)
        return error.returncode
    print('Supabase synced.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
