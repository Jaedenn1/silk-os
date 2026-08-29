const DEFAULT_ROUTER_MODEL = "gpt-5-nano";
const DEFAULT_ROUTINE_MODEL = "gpt-5.6-luna";
const DEFAULT_COMPLEX_MODEL = "gpt-5.6-terra";

function classifyAutomaticChatTier(message) {
  const text = String(message || "").trim();
  const microPattern =
    /^(?:hi|hello|hey|thanks|thank you|good (?:morning|afternoon|evening)|what(?:'s| is) next|mark .+ done|show .+|open .+|status)\b/i;
  const simpleArithmetic =
    text.length <= 120 && /(?:^|\b)(?:what(?:'s| is)\s+)?\d+(?:\.\d+)?\s*[+\-*/]\s*\d+(?:\.\d+)?/i.test(text);
  const strongComplexPattern =
    /\b(architecture|code review|debug(?:ging)?|root cause|trade-?offs?|system design|research plan|deep analysis|diagnos(?:e|is)|multi-step|step-by-step strategy)\b/i;
  const complexityPatterns = [
    /\bcompare\b/i,
    /\banaly[sz]e\b/i,
    /\bevidence\b/i,
    /\brecommend\b/i,
    /\bevaluate\b/i,
    /\btrade-?offs?\b/i,
    /\bstrategy\b/i,
    /\bdesign\b/i,
    /\barchitecture\b/i,
    /\bdebug(?:ging)?\b/i,
    /\bcode review\b/i,
  ];
  const complexitySignals = complexityPatterns.reduce(
    (total, pattern) => total + (pattern.test(text) ? 1 : 0),
    0,
  );
  const compoundComplexity = complexitySignals >= 3 ||
    (complexitySignals >= 2 && text.length > 140);
  const longComplexity = text.length > 500;

  if (strongComplexPattern.test(text) || compoundComplexity || longComplexity) return "complex";
  if (text.length <= 120 && (microPattern.test(text) || simpleArithmetic)) return "micro";
  return "routine";
}

function routeAutomaticModelEnv(env, tier) {
  const routed = { ...env };
  const routerModel = env?.OPENAI_ROUTER_MODEL || DEFAULT_ROUTER_MODEL;
  const routineModel = env?.OPENAI_ROUTINE_MODEL || DEFAULT_ROUTINE_MODEL;
  const complexModel = env?.OPENAI_COMPLEX_MODEL || DEFAULT_COMPLEX_MODEL;

  if (tier === "micro") {
    // The legacy core may call a tiny arithmetic request "routine". Point both
    // possible chat tiers at Nano while leaving the router model itself intact
    // for background memory extraction.
    routed.OPENAI_ROUTINE_MODEL = routerModel;
    routed.OPENAI_COMPLEX_MODEL = routerModel;
  } else if (tier === "routine") {
    // Neutralize legacy keyword escalation (for example, a short "explain why"
    // request) without changing explicit Best mode or background micro tasks.
    routed.OPENAI_COMPLEX_MODEL = routineModel;
  } else if (tier === "complex") {
    // If a genuinely difficult prompt does not match the legacy core's older
    // keyword list, make its routine route resolve to Terra.
    routed.OPENAI_ROUTINE_MODEL = complexModel;
  }

  return routed;
}

export {
  classifyAutomaticChatTier,
  routeAutomaticModelEnv,
};
