// 10과정 수업 클리닉(사례 진단 게임): 진단(diagnose)·처방(prescribe) 서술형 답을 Solar가 채점한다.
// 사례 본문·정답 요인·모범 처방은 프런트가 보내고(11과정 채점 패턴), 서버는 채점만 담당.
const UPSTAGE_KEY = process.env.UPSTAGE_API_KEY;
const JSON_NOTE = '\n(JSON 문자열 값 안에서는 큰따옴표를 쓰지 말 것 — 인용이 필요하면 작은따옴표나 「」 사용)';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  if (!UPSTAGE_KEY) { res.status(500).json({ error: '서버에 UPSTAGE_API_KEY가 설정되지 않았습니다.' }); return; }

  try {
    const { pw, mode } = req.body || {};
    // 화면 잠금과 별개로 서버에서도 비밀번호를 검사해 무단 API 호출을 막는다
    if (pw !== 'tlsekq') { res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' }); return; }
    // 게임 시작 시 잠금 해제 확인용 (LLM 호출 없음)
    if (mode === 'verify') { res.status(200).json({ ok: true }); return; }

    const answer = String(req.body.answer ?? '').trim().slice(0, 1200);
    const story = String(req.body.story ?? '').trim().slice(0, 2500);
    const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 3).map((s) => String(s).slice(0, 200)) : [];
    if (!answer) { res.status(400).json({ error: '답변이 없습니다.' }); return; }
    if (!story || items.length !== 3) { res.status(400).json({ error: '사례 데이터가 올바르지 않습니다.' }); return; }

    // 채점 조작 시도(프롬프트 주입)는 LLM에 보내지 않고 서버에서 바로 차단
    if (/hits|모두\s*true|정답\s*처리|만점|관리자|\[\s*시스템|시스템\s*(메시지|공지|입니다)|프롬프트|prompt|무시하고|지시(사항)?를\s*따르/i.test(answer)) {
      res.status(200).json({ hits: [false, false, false], creative: false, comment: '사례 속 수업 장면에서 본 것으로 답해 주세요.' });
      return;
    }
    // 'ㅁㅁㅁ'·'ddd' 같은 자모 나열·글자 반복 등 무의미 답변도 LLM에 보내지 않고 전 항목 불인정 (12과정 detective.js와 같은 장치)
    const core = answer.replace(/[\s\d\p{P}\p{S}]/gu, '');
    if (!core || /^[ㄱ-ㅎㅏ-ㅣ]+$/.test(core) || new Set(core).size <= 3) {
      res.status(200).json({ hits: [false, false, false], creative: false, comment: '의미가 담긴 문장으로 적어 주세요. 사례 속 수업 장면에서 본 것을 근거로 답해 보세요.' });
      return;
    }

    const askRaw = async (prompt, maxTokens, temp) => {
      const r = await fetch('https://api.upstage.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'solar-pro3',
          messages: [{ role: 'user', content: prompt }],
          temperature: temp,
          max_tokens: maxTokens,
        }),
      });
      if (!r.ok) { const t = await r.text(); throw Object.assign(new Error(`AI 요청 실패 (${r.status})`), { detail: t.slice(0, 300) }); }
      const c = await r.json();
      return ((c.choices && c.choices[0] && c.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    };
    const ask = async (prompt, maxTokens, temp) => {
      const guarded = prompt + JSON_NOTE;
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await askRaw(guarded, maxTokens, temp);
        const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
        if (s !== -1 && e !== -1) { try { return JSON.parse(raw.slice(s, e + 1)); } catch (err) { /* 재시도 */ } }
      }
      throw new Error('AI 응답 JSON 해석 실패 (2회 시도)');
    };

    if (mode === 'diagnose') {
      const prompt = `당신은 수업 사례를 진단하는 연수 게임의 채점관입니다.
아래 수업 사례에는 '참여 저해 요인' 3가지가 숨어 있습니다. 연수생(교사)이 사례를 읽고 진단을 적었습니다.

<수업 사례>
${story}
</수업 사례>

<정답 요인 3가지>
1. ${items[0]}
2. ${items[1]}
3. ${items[2]}
</정답 요인 3가지>

<연수생의 진단>
${answer}
</연수생의 진단>

채점 절차:
1. 연수생의 진단을 요인별로 대조한다. 용어가 정확히 같지 않아도 의미가 통하면 인정한다. (예: '한 명이 다 해먹고 나머지는 구경만 한다' → 독점과 소외 인정)
2. 사례 속 장면을 근거로 다르게 표현한 것도 인정한다. 단, 막연한 답('수업이 재미없다', '학생이 문제다')은 어떤 요인으로도 인정하지 않는다. 진단에 적혀 있지 않은 내용을 좋게 추측해 채워 주면 안 되며, 무의미한 글자 나열이면 세 항목 모두 false.
3. comment는 격려하는 동료 말투 2문장 이내 — 맞힌 것을 짚어 칭찬하고, 놓친 요인이 있으면 사례의 어느 장면에 있었는지 알려 준다. 존댓말.

{"hits":[true 또는 false, true 또는 false, true 또는 false],"comment":"..."} JSON으로만 출력하세요. hits 순서는 정답 요인 1·2·3 순서. 다른 텍스트 금지.`;
      const d = await ask(prompt, 2200, 0.1);
      const hits = Array.isArray(d.hits) ? d.hits.slice(0, 3).map(Boolean) : [false, false, false];
      while (hits.length < 3) hits.push(false);
      res.status(200).json({ hits, comment: String(d.comment ?? '').slice(0, 400) });
      return;
    }

    if (mode === 'prescribe') {
      const factors = Array.isArray(req.body.factors) ? req.body.factors.slice(0, 3).map((s) => String(s).slice(0, 200)) : [];
      const prompt = `당신은 수업 사례를 진단하는 연수 게임의 채점관입니다.
아래 수업 사례의 참여 저해 요인이 공개되었고, 연수생(교사)이 'AI·디지털을 활용한 처방(수업 방법과 도구)'을 적었습니다.

<수업 사례>
${story}
</수업 사례>

<참여 저해 요인>
${factors.map((f, i) => `${i + 1}. ${f}`).join('\n')}
</참여 저해 요인>

<모범 처방 3가지>
1. ${items[0]}
2. ${items[1]}
3. ${items[2]}
</모범 처방 3가지>

<연수생의 처방>
${answer}
</연수생의 처방>

채점 절차:
1. 연수생의 처방을 모범 처방별로 대조한다. 도구 이름이나 표현이 달라도 같은 방향이면 인정한다. (예: '띵커벨로 모두 의견을 올리게 한다' → 디지털 협업 도구 인정)
2. 모범 처방에는 없지만 이 사례의 저해 요인을 실제로 해결할 수 있는 구체적 아이디어가 있으면 creative를 true로 하고 creativeNote에 1문장으로 짚는다. 막연한 답('AI를 활용한다', '열심히 지도한다')은 어느 것으로도 인정하지 않는다. 처방에 적혀 있지 않은 내용을 좋게 추측해 채워 주면 안 되며, 무의미한 글자 나열이면 세 항목 모두 false.
3. comment는 격려하는 동료 말투 2문장 이내. 존댓말.

{"hits":[true 또는 false, true 또는 false, true 또는 false],"creative":true 또는 false,"creativeNote":"...","comment":"..."} JSON으로만 출력하세요. hits 순서는 모범 처방 1·2·3 순서. 다른 텍스트 금지.`;
      const d = await ask(prompt, 2200, 0.1);
      const hits = Array.isArray(d.hits) ? d.hits.slice(0, 3).map(Boolean) : [false, false, false];
      while (hits.length < 3) hits.push(false);
      res.status(200).json({
        hits,
        creative: !!d.creative,
        creativeNote: String(d.creativeNote ?? '').slice(0, 200),
        comment: String(d.comment ?? '').slice(0, 400),
      });
      return;
    }

    res.status(400).json({ error: '알 수 없는 mode 입니다.' });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다.', detail: String(e.detail || e.message).slice(0, 300) });
  }
};
