"""Expose native reasoning controls without modifying account configuration."""
import asyncio


def _efforts(model_id):
    provider, _, model = str(model_id).partition(":")
    if provider != "openai-codex":
        return []
    from agent.reasoning_effort import codex_supported_efforts
    return ["default", *codex_supported_efforts(model)]


def _option(server, state):
    models = server._build_model_state(state)
    current = models.current_model_id if models else ""
    levels = _efforts(current)
    if not levels:
        return None
    reasoning = getattr(state.agent, "reasoning_config", None)
    choice = getattr(state, "_cmc_reasoning_choice", None) or ("none" if reasoning and reasoning.get("enabled") is False else (reasoning or {}).get("effort", "default"))
    return {
        "id": "reasoning_effort", "name": "思考强度", "category": "thought_level",
        "type": "select", "current_value": choice if choice in levels else "default",
        "options": [{"value": level, "name": level} for level in levels],
    }


def install(agent_class):
    fields = agent_class._session_response_fields
    set_option = agent_class.set_config_option
    switch_model = agent_class._switch_model

    def model_switch(self, state, raw_model, **kwargs):
        result = switch_model(self, state, raw_model, **kwargs)
        state._cmc_reasoning_choice = None
        return result

    async def session_fields(self, state, replay_verb=None):
        result = await fields(self, state, replay_verb)
        models = result.get("models")
        option = _option(self, state)
        result["config_options"] = [option] if option else []
        result["field_meta"] = {
            **(result.get("field_meta") or {}),
            "cmcReasoningAdapter": 1,
            "reasoningModels": [
                {"modelId": model.model_id, "efforts": _efforts(model.model_id)}
                for model in (models.available_models if models else [])
            ],
        }
        return result

    async def reasoning_option(self, config_id, session_id, value, **kwargs):
        if config_id != "reasoning_effort":
            return await set_option(self, config_id, session_id, value, **kwargs)
        from acp.exceptions import RequestError
        from acp.schema import SetSessionConfigOptionResponse
        from hermes_constants import parse_reasoning_effort, resolve_reasoning_config
        from hermes_cli.config import load_config
        state = await asyncio.to_thread(self.session_manager.get_session, session_id)
        option = _option(self, state) if state else None
        if not option or value not in [entry["value"] for entry in option["options"]]:
            raise RequestError(-32602, "当前 Hermes 模型不支持此思考强度")
        state.agent.reasoning_config = (
            resolve_reasoning_config(load_config(), state.agent.model)
            if value == "default" else parse_reasoning_effort(value)
        )
        state._cmc_reasoning_choice = value
        return SetSessionConfigOptionResponse(
            config_options=[_option(self, state)],
            field_meta={"cmcReasoningAdapter": 1, "reasoningConfig": state.agent.reasoning_config},
        )

    agent_class._session_response_fields = session_fields
    agent_class.set_config_option = reasoning_option
    agent_class._switch_model = model_switch
