// 13과정 데이터 리터러시 연습: 가상 수업 분석 데이터 생성(scenario) + 교사 해석과 AI 해석 비교(compare)
const UPSTAGE_KEY = process.env.UPSTAGE_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  if (!UPSTAGE_KEY) { res.status(500).json({ error: '서버에 UPSTAGE_API_KEY가 설정되지 않았습니다.' }); return; }

  try {
    const { pw, mode } = req.body || {};
    // 화면 잠금과 별개로 서버에서도 비밀번호를 검사해 무단 API 호출을 막는다
    if (pw !== 'tlsekq') { res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' }); return; }

    const ask = async (prompt, maxTokens) => {
      const r = await fetch('https://api.upstage.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'solar-pro2',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8,
          max_tokens: maxTokens,
        }),
      });
      if (!r.ok) { const t = await r.text(); throw Object.assign(new Error(`AI 요청 실패 (${r.status})`), { detail: t.slice(0, 300) }); }
      const c = await r.json();
      const raw = (c.choices && c.choices[0] && c.choices[0].message.content) || '';
      const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
      if (s === -1 || e === -1) throw new Error('AI 응답에서 JSON을 찾지 못함');
      return JSON.parse(raw.slice(s, e + 1));
    };

    if (mode === 'scenario') {
      const seed = String(req.body.seed ?? '').slice(0, 50);
      const prompt = `당신은 AI 수업 분석 도구가 만든 '가상 수업 분석 리포트'를 생성합니다.
초등 또는 중등의 한 차시 수업을 가정하고, 교사가 해석 연습을 할 분석 데이터를 만드세요. (변화 시드: ${seed || '무작위'})

원칙:
- 수업 맥락(학년·과목·활동)을 한 줄로.
- 지표 4개: 발화·참여·상호작용 계열에서 고르되 매번 조합을 다르게 (예: 교사 발화 점유율, 학생 침묵 비율, 학생 상호작용 비율, 발언 학생 비율, 질문 중 사고형 질문 비율, 도구 활용 시간 비율 등). 값은 %(0~100).
- 데이터에는 "함정"을 하나 심을 것 — 숫자만 보면 나쁘게(또는 좋게) 보이지만 관찰 메모를 보면 다르게 해석될 수 있는 지점. 예) 침묵 비율이 높지만 메모에는 '개별 글쓰기 활동 중'이라고 적혀 있음.
- 관찰 메모는 수업 상황을 담백하게 1~2문장.

{"context":"3학년 수학 · 분수 개념 도입 · 모둠 활동 수업","metrics":[{"name":"교사 발화 점유율","value":70},{"name":"학생 침묵 비율","value":20},{"name":"학생 상호작용 비율","value":10},{"name":"발언 학생 비율","value":25}],"memo":"관찰 메모 1~2문장"} 형식의 JSON으로만 출력하세요. 다른 텍스트 금지.`;
      const d = await ask(prompt, 700);
      const metrics = (Array.isArray(d.metrics) ? d.metrics : []).slice(0, 5).map((m) => ({
        name: String((m && m.name) ?? '').slice(0, 40),
        value: Math.max(0, Math.min(100, Number((m && m.value) ?? 0) || 0)),
      })).filter((m) => m.name);
      if (metrics.length < 3) throw new Error('AI가 지표를 충분히 만들지 못했어요. 다시 시도해 주세요.');
      res.status(200).json({
        context: String(d.context ?? '').slice(0, 120),
        metrics,
        memo: String(d.memo ?? '').slice(0, 300),
      });
      return;
    }

    if (mode === 'compare') {
      const scenario = String(req.body.scenario ?? '').trim().slice(0, 800);
      const fact = String(req.body.fact ?? '').trim().slice(0, 600);
      const action = String(req.body.action ?? '').trim().slice(0, 600);
      if (!scenario) { res.status(400).json({ error: '분석 데이터가 없습니다.' }); return; }
      if (!fact && !action) { res.status(400).json({ error: '나의 해석(Fact 또는 Action)을 먼저 적어 주세요.' }); return; }

      const prompt = `당신은 수업 분석 데이터를 함께 읽는 수석교사입니다.

<가상 수업 분석 데이터>
${scenario}
</가상 수업 분석 데이터>

<교사의 해석>
사실(Fact): ${fact || '미입력'}
개선 전략(Action): ${action || '미입력'}
</교사의 해석>

당신의 해석을 제시하고, 교사의 해석과 비교해 주세요. 원칙:
- ai_fact: 데이터가 말해주는 사실 2~3개. 숫자와 관찰 메모를 함께 읽을 것. 줄바꿈(\\n)으로 구분.
- ai_action: 현실적인 개선 전략 2개. 줄바꿈 구분.
- ai_caution: 이 데이터에서 "숫자만 보면 틀리게 해석하기 쉬운 지점" 1개 — 관찰 메모나 맥락 없이 단정하면 안 되는 이유.
- comment: 교사의 해석에서 좋았던 점 1가지 + 더 생각해 볼 관점 1가지. 평가·훈계 말고 동료 관점으로, 2~3문장.

{"ai_fact":"...","ai_action":"...","ai_caution":"...","comment":"..."} JSON으로만 출력하세요. 다른 텍스트 금지.`;
      const d = await ask(prompt, 900);
      res.status(200).json({
        ai_fact: String(d.ai_fact ?? '').slice(0, 600),
        ai_action: String(d.ai_action ?? '').slice(0, 600),
        ai_caution: String(d.ai_caution ?? '').slice(0, 400),
        comment: String(d.comment ?? '').slice(0, 500),
      });
      return;
    }

    res.status(400).json({ error: '알 수 없는 mode 입니다.' });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다.', detail: String(e.detail || e.message).slice(0, 300) });
  }
};
