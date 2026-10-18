import json
import os
import sys
from model_account_hermes_api import CODEX_BASE, oauth_login, oauth_credentials, request_model

def main():
    data = json.load(sys.stdin)
    if data['action'] == 'oauth':
        return oauth_login()
    from hermes_cli.config import (get_config_path, require_readable_config_before_write,
        save_config, save_env_value, get_env_value, custom_endpoint_key_env,
        clear_model_endpoint_credentials, split_model_config_default)
    from hermes_cli.auth import PROVIDER_REGISTRY, get_api_key_provider_status, get_codex_auth_status
    config = require_readable_config_before_write()
    raw = config.get('model', {})
    model = dict(raw) if isinstance(raw, dict) else {'default': raw} if raw else {}
    default_model, nested_provider = split_model_config_default(model.get('default'))
    provider = model.get('provider') or nested_provider or 'openrouter'
    registry = PROVIDER_REGISTRY.get(provider)
    openrouter = provider == 'openrouter'
    snapshot = {}
    oauth_status = get_codex_auth_status()
    oauth_configured = bool(oauth_status.get('logged_in')) and str(oauth_status.get('base_url', '')).rstrip('/') == CODEX_BASE
    if provider == 'custom':
        key_env = model.get('key_env') or model.get('api_key_env')
        key = get_env_value(key_env) if key_env else model.get('api_key')
        current_base = model.get('base_url', '')
    elif openrouter:
        key_env = 'OPENROUTER_API_KEY'
        key = get_env_value(key_env)
        current_base = model.get('base_url') or get_env_value('OPENROUTER_BASE_URL') or 'https://openrouter.ai/api/v1'
    elif registry and registry.auth_type == 'api_key':
        snapshot = get_api_key_provider_status(provider)
        key = next((get_env_value(name) for name in registry.api_key_env_vars if get_env_value(name)), None)
        # 原生 vault 状态也能报告已配置，测试时由原生解析器读取。
        current_base = model.get('base_url') or snapshot.get('base_url') or registry.inference_base_url
        key_env = next((name for name in registry.api_key_env_vars if get_env_value(name)), registry.api_key_env_vars[0])
    else:
        key, key_env = None, None
        current_base = CODEX_BASE if provider == 'openai-codex' else model.get('base_url', '')
    from urllib.parse import urlsplit
    parsed = urlsplit(str(current_base))
    public_base = current_base if not (parsed.username or parsed.password or parsed.query or parsed.fragment) else ''
    if data['action'] == 'status':
        has_key = bool(key) or (bool(snapshot.get('configured')) if registry and registry.auth_type == 'api_key' and provider != 'custom' else False)
        return dict(app='hermes', name='Hermes', installed=True, configured=oauth_configured if provider == 'openai-codex' else has_key and bool(public_base), hasKey=has_key, oauthConfigured=oauth_configured,
                    keyWritable=not bool(key_env and os.environ.get(key_env)), keySource='env' if key_env and os.environ.get(key_env) else 'file',
                    provider=provider, baseUrl=public_base, model=default_model, apiMode=model.get('api_mode', ''), configPath=str(get_config_path()))
    selected = data['provider']
    selected_registry = PROVIDER_REGISTRY.get(selected)
    if selected == 'openai-codex':
        if data['baseUrl'] != CODEX_BASE or data.get('apiKey'):
            raise ValueError('OpenAI 授权使用官方地址，无需填写 API Key')
        if not oauth_configured:
            raise ValueError('请先完成 OpenAI 授权')
        if data['action'] in ('models', 'test'):
            return request_model(data, oauth_credentials(), 'codex_responses')
        clear_model_endpoint_credentials(model)
        model.update(provider=selected, default=data['model'], base_url=CODEX_BASE, api_mode='codex_responses')
        config['model'] = model
        save_config(config, preserve_keys={('model', 'provider'), ('model', 'default'), ('model', 'base_url')})
        return dict(ok=True, message='已保存，新建 Hermes 会话后生效')
    if (selected != provider or data['baseUrl'] != str(current_base).rstrip('/')) and not data.get('apiKey'):
        raise ValueError('更换供应商或服务地址时请重新填写 API Key')
    secret = data.get('apiKey') or key
    if not secret and selected != 'custom':
        from hermes_cli.auth import resolve_api_key_provider_credentials
        secret = resolve_api_key_provider_credentials(selected).get('api_key')
    if not secret:
        raise ValueError('请填写 API Key')
    target_env = custom_endpoint_key_env(data['baseUrl']) if selected == 'custom' else 'OPENROUTER_API_KEY' if selected == 'openrouter' else selected_registry.api_key_env_vars[0]
    if data.get('apiKey') and os.environ.get(target_env):
        raise ValueError('当前密钥来自进程环境变量，请先在电脑环境变量中修改')
    from hermes_cli.runtime_provider import _fallback_api_mode, _configured_api_mode
    same_endpoint = selected == provider and data['baseUrl'] == str(current_base).rstrip('/')
    mode = data.get('apiMode') or (_configured_api_mode(selected, model) if same_endpoint else None) or ('chat_completions' if selected in ('custom', 'openrouter') else _fallback_api_mode(selected, data['baseUrl'], data['model']))
    if data['action'] in ('models', 'test'):
        return request_model(data, secret, mode)
    clear_model_endpoint_credentials(model)
    model.update(provider=selected, default=data['model'], base_url=data['baseUrl'], api_mode=mode)
    if selected == 'custom':
        model.update(key_env=target_env)
    # Migrate an existing inline custom key before clearing the endpoint fields.
    if data.get('apiKey') or (selected == 'custom' and not get_env_value(target_env)):
        save_env_value(target_env, secret)
    config['model'] = model
    save_config(config, preserve_keys={('model', 'provider'), ('model', 'default'), ('model', 'base_url')})
    return dict(ok=True, message='已保存，新建 Hermes 会话后生效')

try:
    result = main()
except (Exception, SystemExit) as error:
    message = str(error)
    allowed = ('更换供应商', '请填写 API Key', '当前密钥来自', '服务拒绝认证', '服务检查失败', '无法连接服务', '服务未返回', '服务未完成', 'OpenAI 授权', '请先完成 OpenAI 授权', '请重新完成 OpenAI 授权')
    result = {'error': message if message.startswith(allowed) else '操作失败，请检查网络、Hermes 安装和原生配置；授权失败时可重新发起'}
print(json.dumps(result, ensure_ascii=False), flush=True)
if 'error' in result:
    sys.exit(1)
