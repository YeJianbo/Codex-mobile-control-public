import contextlib
import io
import json
import sys
import time

CODEX_BASE = 'https://chatgpt.com/backend-api/codex'


def oauth_login():
    from dataclasses import replace
    from types import SimpleNamespace
    from hermes_cli import auth_codex, auth_commands
    output = sys.stdout
    original = auth_codex._codex_request_device_code

    def request(issuer, client_id):
        value = original(issuer, client_id)
        output.write(json.dumps(dict(event='challenge', verificationUrl='https://auth.openai.com/codex/device', userCode=value['user_code'])) + '\n')
        output.flush()
        return value

    # 只在 helper 进程内选择原生设备码流程，凭据仍由 Hermes 账户池保存。
    auth_codex._codex_request_device_code = request
    auth_codex._codex_base_url = lambda: CODEX_BASE
    spec = auth_commands._OAUTH_ADD_SPECS['openai-codex']
    auth_commands._OAUTH_ADD_SPECS['openai-codex'] = replace(spec, login=lambda args: auth_codex._codex_device_code_login())
    args = SimpleNamespace(provider='openai-codex', auth_type='oauth', label='Local Console', priority=None, browser=False, no_browser=True)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        auth_commands.auth_add_command(args)
    return dict(event='complete')


def oauth_credentials():
    from hermes_cli import auth_codex
    from hermes_cli.auth import _codex_access_token_is_expiring
    # 检查时只使用 Hermes 已有凭据，不导入 Codex CLI 的刷新令牌。
    auth_codex._recover_codex_tokens_from_cli = lambda *args, **kwargs: None
    creds = auth_codex.resolve_codex_runtime_credentials()
    if str(creds.get('base_url', '')).rstrip('/') != CODEX_BASE:
        raise ValueError('OpenAI 授权地址与官方接口不一致，请重新授权')
    secret = creds['api_key']
    if creds.get('source') == 'credential_pool' and _codex_access_token_is_expiring(secret, 60):
        from agent.credential_pool import load_pool
        refreshed = load_pool('openai-codex').try_refresh_matching(api_key_hint=secret)
        if refreshed is None:
            raise ValueError('请重新完成 OpenAI 授权')
        secret = refreshed.runtime_api_key
    return secret


def model_ids(values, secret):
    ids = []
    for value in values:
        if isinstance(value, str) and value and len(value) <= 256 and not any(ord(c) < 32 for c in value) and secret not in value and value not in ids:
            ids.append(value)
    if not ids:
        raise ValueError('服务未返回可用模型')
    return dict(ok=True, models=ids[:500], message='已获取 %d 个模型' % min(len(ids), 500))


def bounded_body(response):
    chunks, size = [], 0
    for chunk in response.iter_bytes():
        size += len(chunk)
        if size > 2 * 1024 * 1024:
            raise ValueError('服务未返回可识别的响应')
        chunks.append(chunk)
    return b''.join(chunks)


def response_text(body):
    return ''.join(content.get('text', '') for row in body.get('output', []) if isinstance(row, dict) for content in row.get('content', []) if isinstance(content, dict) and content.get('type') == 'output_text')


def request_model(data, secret, mode):
    import httpx
    base = data['baseUrl'].rstrip('/')
    oauth = data['provider'] == 'openai-codex'
    headers = {'Authorization': 'Bearer ' + secret}
    if mode == 'anthropic_messages':
        headers = {'x-api-key': secret, 'anthropic-version': '2023-06-01'}
    if oauth:
        from agent.codex_headers import codex_account_headers
        headers.update(codex_account_headers(secret))
    started = time.monotonic()
    with httpx.Client(timeout=20, follow_redirects=False) as client:
        def check(response):
            if response.status_code in (401, 403):
                raise ValueError('服务拒绝认证，请重新授权' if oauth else '服务拒绝认证，请检查 API Key')
            if not 200 <= response.status_code < 300:
                raise ValueError('服务检查失败（HTTP %d）' % response.status_code)

        if data['action'] == 'models':
            if oauth:
                from agent.model_metadata import fetch_codex_catalog_entries
                from hermes_cli.codex_models import _ranked_slugs
                entries, status = fetch_codex_catalog_entries(lambda url: client.get(url, headers=headers), base_url=base)
                if status != 200:
                    raise ValueError('服务检查失败（HTTP %s）' % status)
                return model_ids(_ranked_slugs(entries), secret)
            url = base + ('/models' if base.endswith('/v1') else '/v1/models')
            with client.stream('GET', url, headers=headers) as response:
                check(response)
                body = json.loads(bounded_body(response))
            if not isinstance(body.get('data'), list):
                raise ValueError('服务未返回可识别的模型目录')
            return model_ids((row.get('id') for row in body['data'] if isinstance(row, dict)), secret)

        root = base if base.endswith('/v1') or oauth else base + '/v1'
        if mode == 'anthropic_messages':
            url = root + '/messages'
            payload = dict(model=data['model'], max_tokens=128, messages=[dict(role='user', content='Reply with only OK.')])
        elif mode in ('codex_responses', 'responses'):
            url = root + '/responses'
            payload = dict(model=data['model'], input=[dict(role='user', content=[dict(type='input_text', text='Reply with only OK.')])], instructions='You are a helpful assistant.', store=False, stream=oauth)
            if not oauth:
                payload['max_output_tokens'] = 512
        else:
            url = root + '/chat/completions'
            payload = dict(model=data['model'], max_tokens=512, messages=[dict(role='user', content='Reply with only OK.')], stream=False)
        with client.stream('POST', url, headers=headers, json=payload) as response:
            check(response)
            if oauth:
                reply, completed, size = '', False, 0
                for line in response.iter_lines():
                    size += len(line)
                    if size > 2 * 1024 * 1024:
                        raise ValueError('服务未返回可识别的响应')
                    if not line.startswith('data:') or line[5:].strip() == '[DONE]':
                        continue
                    event = json.loads(line[5:].strip())
                    if event.get('type') in ('error', 'response.failed', 'response.incomplete'):
                        raise ValueError('服务未完成模型请求，请确认模型及账户额度')
                    if event.get('type') == 'response.output_text.delta':
                        reply += event.get('delta', '')
                    if event.get('type') == 'response.completed':
                        completed = True
                        reply = response_text(event.get('response', {})) or reply
                        break
                if not completed:
                    raise ValueError('服务未完成模型请求，请确认模型及账户额度')
            else:
                body = json.loads(bounded_body(response))
                if mode == 'anthropic_messages':
                    reply = ''.join(row.get('text', '') for row in body.get('content', []) if row.get('type') == 'text')
                elif mode in ('codex_responses', 'responses'):
                    if body.get('status') not in (None, 'completed'):
                        raise ValueError('服务未完成模型请求，请确认模型及账户额度')
                    reply = response_text(body)
                else:
                    reply = (body.get('choices') or [{}])[0].get('message', {}).get('content', '')
        reply = str(reply or '').replace(secret, '[已隐藏]')
        reply = ''.join(' ' if ord(char) < 32 else char for char in reply)[:160]
        if not reply.strip():
            raise ValueError('服务未返回模型文本回复，请确认模型及接口协议')
        elapsed = round((time.monotonic() - started) * 1000)
        return dict(ok=True, reply=reply, elapsedMs=elapsed, message='连接成功 · %d ms · 回复：%s' % (elapsed, reply))
