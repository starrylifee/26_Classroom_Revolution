// 10과정 시연 발화 분석: 수업 시연 전사문(브라우저 STT)을 Solar가 수업 코치 관점으로 분석한다.
// 오디오는 서버로 오지 않는다 — 텍스트 전사문만 받는다.
const UPSTAGE_KEY = process.env.UPSTAGE_API_KEY;
const JSON_NOTE = '\n(JSON 문자열 값 안에서는 큰따옴표를 쓰지 말 것 — 인용이 필요하면 작은따옴표나 「」 사용)';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  if (!UPSTAGE_KEY) { res.status(500).json({ error: '서버에 UPSTAGE_API_KEY가 설정되지 않았습니다.' }); return; }

  try {
    const { pw, mode } = req.body || {};
    // 화면 잠금과 별개로 서버에서도 비밀번호를 검사해 무단 API 호출을 막는다
    if (pw !== 'tlsekq') { res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' }); return; }
    if (mode === 'verify') { res.status(200).json({ ok: true }); return; }

    if (mode !== 'analyze') { res.status(400).json({ error: '알 수 없는 mode 입니다.' }); return; }

    const transcript = String(req.body.transcript ?? '').trim().slice(0, 12000);
    const stats = String(req.body.stats ?? '').trim().slice(0, 500);
    if (transcript.length < 100) { res.status(400).json({ error: '전사문이 너무 짧습니다. 1~2분 이상 발화한 내용으로 분석해 주세요.' }); return; }

    const prompt = `당신은 수업 시연(마이크로티칭)을 참관한 수석교사입니다.
아래는 시연 교사의 발화를 음성인식으로 받아 적은 전사문입니다. 음성인식 특성상 오탈자·띄어쓰기 오류·문장부호 누락이 있으니 의미로 읽으세요. 학생 목소리가 일부 섞였을 수 있습니다.

<전사문>
${transcript}
</전사문>

<측정치>
${stats || '측정치 없음'}
</측정치>

이 시연을 '학생 참여 촉진 / 교사-학생-AI 상호작용 / 데이터 기반 평가' 관점으로 분석하세요. 원칙:
- 반드시 전사문에 실제로 나온 표현을 인용(「」)해 근거로 삼을 것. 전사문에 없는 내용을 지어내지 말 것.
- summary: 이 시연 발화의 특징 한 줄 요약.
- questions: 발문 분석 — 전사문 속 발문을 개방형(사고 확장)과 폐쇄형(단답 확인)으로 나눠 대략의 비율 느낌과 대표 예 각 1~2개. 발문이 거의 없으면 그 사실을 짚을 것. 줄바꿈(\\n) 구분.
- habits: 언어 습관 — 반복되는 말버릇·군말(예: 자, 어, 그래서), 지시 위주 표현 등 눈에 띄는 습관 2~3개와 빈도 느낌. 줄바꿈 구분.
- strengths: 참여·상호작용 관점에서 잘한 지점 2개. 인용 근거 포함. 줄바꿈 구분.
- improvements: 보완 지점 2개 — 각각 '어떤 장면(인용) → 이렇게 바꾸면(대안 발화 예)' 형태로. 줄바꿈 구분.
- rewrite: 전사문 속 실제 발문(또는 지시) 2개를 골라 사고를 확장하는 발문으로 고쳐 쓴 예. '원래: … → 제안: …' 형태 2줄.
- comment: 격려하는 동료 관점의 한마디. 2문장 이내. 존댓말.

{"summary":"...","questions":"...","habits":"...","strengths":"...","improvements":"...","rewrite":"...","comment":"..."} JSON으로만 출력하세요. 다른 텍스트 금지.`;

    const askRaw = async (p, maxTokens, temp) => {
      const r = await fetch('https://api.upstage.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'solar-pro3',
          messages: [{ role: 'user', content: p }],
          temperature: temp,
          max_tokens: maxTokens,
        }),
      });
      if (!r.ok) { const t = await r.text(); throw Object.assign(new Error(`AI 요청 실패 (${r.status})`), { detail: t.slice(0, 300) }); }
      const c = await r.json();
      return ((c.choices && c.choices[0] && c.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    };
    let d = null;
    for (let attempt = 0; attempt < 2 && !d; attempt++) {
      const raw = await askRaw(prompt + JSON_NOTE, 4200, 0.3);
      const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
      if (s !== -1 && e !== -1) { try { d = JSON.parse(raw.slice(s, e + 1)); } catch (err) { /* 재시도 */ } }
    }
    if (!d) throw new Error('AI 응답 JSON 해석 실패 (2회 시도)');

    res.status(200).json({
      summary: String(d.summary ?? '').slice(0, 300),
      questions: String(d.questions ?? '').slice(0, 800),
      habits: String(d.habits ?? '').slice(0, 600),
      strengths: String(d.strengths ?? '').slice(0, 700),
      improvements: String(d.improvements ?? '').slice(0, 800),
      rewrite: String(d.rewrite ?? '').slice(0, 600),
      comment: String(d.comment ?? '').slice(0, 300),
    });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다.', detail: String(e.detail || e.message).slice(0, 300) });
  }
};
