// 13과정: 자가 진단·스윗 스팟을 받아 성장 로드맵(단기/중기/장기)과 걸림돌 초안을 생성한다.
const UPSTAGE_KEY = process.env.UPSTAGE_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  if (!UPSTAGE_KEY) { res.status(500).json({ error: '서버에 UPSTAGE_API_KEY가 설정되지 않았습니다.' }); return; }

  try {
    const { pw, mode, scores, strong, weak, need, want, goal } = req.body || {};
    // 화면 잠금과 별개로 서버에서도 비밀번호를 검사해 무단 API 호출을 막는다
    if (pw !== 'tlsekq') { res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' }); return; }

    // mode 'kpt': 한 줄 회고를 재료로 KPT(Keep/Problem/Try) 초안 생성
    if (mode === 'kpt') {
      const reviews = String(req.body.reviews ?? '').trim().slice(0, 1500);
      if (!reviews) { res.status(400).json({ error: '한 줄 회고를 먼저 1개 이상 적어 주세요.' }); return; }

      const kPrompt = `당신은 교사 연수 회고를 돕는 퍼실리테이터입니다.
한 교사가 12개 과정 연수를 돌아보며 쓴 한 줄 회고입니다.

<한 줄 회고>
${reviews}
</한 줄 회고>

이 회고를 재료로 KPT 회고 초안을 쓰세요.
- Keep: 잘된 것·이어갈 것 / Problem: 아쉬운 것·문제 / Try: 새로 시도할 것
- 각 칸 2~3줄, 한 줄에 하나씩 줄바꿈(\\n)으로 구분. 교사가 쓴 회고의 표현을 최대한 살릴 것.
- 회고에 없는 내용을 지어내지 말 것. 회고가 짧으면 초안도 짧게.

{"keep":"...","problem":"...","try":"..."} JSON으로만 출력하세요. 다른 텍스트 금지.`;
      const kRes = await fetch('https://api.upstage.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'solar-pro3',
          messages: [{ role: 'user', content: kPrompt }],
          temperature: 0.4,
          max_tokens: 2500,
        }),
      });
      if (!kRes.ok) {
        const t = await kRes.text();
        res.status(502).json({ error: `AI 초안 생성 실패 (${kRes.status})`, detail: t.slice(0, 300) });
        return;
      }
      const kChat = await kRes.json();
      const kRaw = ((kChat.choices && kChat.choices[0] && kChat.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const ks = kRaw.indexOf('{'); const ke = kRaw.lastIndexOf('}');
      if (ks === -1 || ke === -1) throw new Error('AI 응답에서 JSON을 찾지 못함');
      const kDraft = JSON.parse(kRaw.slice(ks, ke + 1));
      res.status(200).json({
        keep: String(kDraft.keep ?? '').slice(0, 500),
        problem: String(kDraft.problem ?? '').slice(0, 500),
        try: String(kDraft.try ?? '').slice(0, 500),
      });
      return;
    }

    // mode 'ba': 한 줄 회고·KPT를 재료로 Before & After 초안 생성
    if (mode === 'ba') {
      const reviews = String(req.body.reviews ?? '').trim().slice(0, 1500);
      const kpt = String(req.body.kpt ?? '').trim().slice(0, 800);
      if (!reviews && !kpt) { res.status(400).json({ error: '한 줄 회고나 KPT를 먼저 적어 주세요.' }); return; }

      const bPrompt = `당신은 교사 연수 회고를 돕는 퍼실리테이터입니다.
한 교사의 연수 회고 기록입니다.

<한 줄 회고>
${reviews || '없음'}
</한 줄 회고>
<KPT 회고>
${kpt || '없음'}
</KPT 회고>

연수 전(Before)과 후(After)의 변화를 세 영역으로 정리한 초안을 쓰세요.
- 영역: 마음가짐 / 수업 설계 / 동료 관계
- 각 칸은 한 문장(20자 내외). 예) Before "AI가 두려웠다" → After "AI가 수업 파트너로 느껴진다"
- 회고 기록에서 근거를 찾을 수 있는 내용만. 지어내지 말고, 근거가 없으면 그 칸은 빈 문자열로.

{"mind_b":"","mind_a":"","design_b":"","design_a":"","peer_b":"","peer_a":""} JSON으로만 출력하세요. 다른 텍스트 금지.`;
      const bRes = await fetch('https://api.upstage.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'solar-pro3',
          messages: [{ role: 'user', content: bPrompt }],
          temperature: 0.4,
          max_tokens: 6000,
        }),
      });
      if (!bRes.ok) {
        const t = await bRes.text();
        res.status(502).json({ error: `AI 초안 생성 실패 (${bRes.status})`, detail: t.slice(0, 300) });
        return;
      }
      const bChat = await bRes.json();
      const bRaw = ((bChat.choices && bChat.choices[0] && bChat.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const bs = bRaw.indexOf('{'); const be = bRaw.lastIndexOf('}');
      if (bs === -1 || be === -1) throw new Error('AI 응답에서 JSON을 찾지 못함');
      const bDraft = JSON.parse(bRaw.slice(bs, be + 1));
      const out = {};
      for (const k of ['mind_b', 'mind_a', 'design_b', 'design_a', 'peer_b', 'peer_a']) {
        out[k] = String(bDraft[k] ?? '').slice(0, 200);
      }
      res.status(200).json(out);
      return;
    }

    // mode 'solutions': 예상 장애물 1개에 대한 극복 방안 5개 제안
    if (mode === 'solutions') {
      const obstacle = String(req.body.obstacle ?? '').trim().slice(0, 300);
      if (!obstacle) { res.status(400).json({ error: '예상 장애물을 입력하세요.' }); return; }

      const sPrompt = `당신은 교사의 AI·디지털 역량 개발을 돕는 연수 컨설턴트입니다.

한 교사가 성장 계획을 실천하는 데 이런 장애물을 예상하고 있습니다.
- 예상 장애물: ${obstacle}
- 교사의 성장 목표: ${String(goal || '').slice(0, 300) || '미입력'}
- 보완이 필요한 역량: ${String(weak || '').slice(0, 100) || '미입력'}

이 장애물을 극복할 현실적인 방안 5개를 제안하세요. 원칙:
- 한국 초·중등 학교 현장에서 바로 실천 가능한 작은 행동으로. 각 방안 40자 이내.
- 5개는 서로 다른 접근일 것 (예: 시간 확보 / 동료 협력 / 작게 시작 / 도구 활용 / 계획 조정).
- "하루 10분만 투자", "동료와 주 1회 티타임"처럼 구체적으로. 뻔한 정신론 금지.

{"solutions":["방안1","방안2","방안3","방안4","방안5"]} JSON으로만 출력하세요. 다른 텍스트 금지.`;
      const sRes = await fetch('https://api.upstage.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'solar-pro3',
          messages: [{ role: 'user', content: sPrompt }],
          temperature: 0.6,
          max_tokens: 2500,
        }),
      });
      if (!sRes.ok) {
        const t = await sRes.text();
        res.status(502).json({ error: `AI 방안 생성 실패 (${sRes.status})`, detail: t.slice(0, 300) });
        return;
      }
      const sChat = await sRes.json();
      const sRaw = ((sChat.choices && sChat.choices[0] && sChat.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const ss = sRaw.indexOf('{');
      const se = sRaw.lastIndexOf('}');
      if (ss === -1 || se === -1) throw new Error('AI 응답에서 JSON을 찾지 못함');
      const sDraft = JSON.parse(sRaw.slice(ss, se + 1));
      const solutions = (Array.isArray(sDraft.solutions) ? sDraft.solutions : [])
        .map((s) => String(s ?? '').trim().slice(0, 120)).filter(Boolean).slice(0, 5);
      res.status(200).json({ solutions });
      return;
    }

    // mode 'goal': Need×Want 모든 조합(최대 3×3=9)에 대해 성장 목표 문장을 하나씩 생성
    if (mode === 'goal') {
      const clean = (arr) => (Array.isArray(arr) ? arr : [])
        .map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 3);
      const needs = clean(req.body.needs);
      const wants = clean(req.body.wants);
      if (!needs.length || !wants.length) {
        res.status(400).json({ error: '학생의 필요와 나의 흥미를 각각 1개 이상 입력하세요.' });
        return;
      }
      const pairs = [];
      needs.forEach((n, ni) => wants.forEach((w, wi) =>
        pairs.push(`${pairs.length + 1}. Need${ni + 1} "${n.slice(0, 100)}" × Want${wi + 1} "${w.slice(0, 100)}"`)));

      const gPrompt = `당신은 교사의 AI·디지털 역량 개발을 돕는 연수 컨설턴트입니다.
- 보완이 필요한 역량: ${String(weak || '').slice(0, 100) || '미입력'}

아래 ${pairs.length}개 조합 각각에 대해, Want를 수단으로 Need 해결을 목적으로 연결한 '성장 목표' 문장을 하나씩 만드세요.

${pairs.join('\n')}

형식 예시: "생성형 AI를 활용해 느린 학습자 맞춤 문제를 만드는 교사 되기 (C·F 역량 보완)"
- "~하는 교사 되기" 꼴로 끝내고, 보완 역량이 있으면 괄호로 덧붙일 것.
- 각 문장 40자 내외, 자연스러운 한국어로. 조합 순서를 그대로 지킬 것.

{"goals":["문장1","문장2",...]} JSON으로만 출력하세요. 배열 길이는 정확히 ${pairs.length}개. 다른 텍스트 금지.`;
      const gRes = await fetch('https://api.upstage.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'solar-pro3',
          messages: [{ role: 'user', content: gPrompt }],
          temperature: 0.5,
          max_tokens: 6000,
        }),
      });
      if (!gRes.ok) {
        const t = await gRes.text();
        res.status(502).json({ error: `AI 문장 생성 실패 (${gRes.status})`, detail: t.slice(0, 300) });
        return;
      }
      const gChat = await gRes.json();
      const gRaw = ((gChat.choices && gChat.choices[0] && gChat.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const gs = gRaw.indexOf('{');
      const ge = gRaw.lastIndexOf('}');
      if (gs === -1 || ge === -1) throw new Error('AI 응답에서 JSON을 찾지 못함');
      const gDraft = JSON.parse(gRaw.slice(gs, ge + 1));
      const src = Array.isArray(gDraft.goals) ? gDraft.goals : [];
      // 배열 길이를 조합 수에 강제로 맞춘다 (부족하면 빈칸 — 프런트에서 걸러짐)
      const goals = Array.from({ length: pairs.length }, (_, i) => String(src[i] ?? '').slice(0, 200));
      res.status(200).json({ goals });
      return;
    }

    const prompt = `당신은 초등·중등 교사의 AI·디지털 역량 개발을 돕는 연수 컨설턴트입니다.
아래는 한 교사의 자가 진단과 성장 스윗 스팟입니다.

- 역량 자가 진단(1~5점): ${String(scores || '').slice(0, 300) || '미입력'}
- 강점 역량: ${String(strong || '').slice(0, 100) || '미입력'}
- 보완 역량: ${String(weak || '').slice(0, 100) || '미입력'}
- 학생의 필요(Need): ${String(need || '').slice(0, 300) || '미입력'}
- 나의 흥미(Want): ${String(want || '').slice(0, 300) || '미입력'}
- 성장 목표: ${String(goal || '').slice(0, 300) || '미입력(직접 제안할 것)'}

이 교사의 1년 성장 로드맵 초안을 작성하세요. 원칙:
- 보완 역량과 성장 목표(Need×Want)에 집중. 모든 역량을 다 하려 하지 말 것.
- 실행 계획은 "관련 원격연수 1개 이수"처럼 작고 구체적인 행동으로. 각 시기 2~3개, 한 줄씩 줄바꿈(\\n)으로 구분.
- 한국 초·중등 학교 현장에서 실제 가능한 수준으로. 화려한 기술 나열 금지.
- 장애물은 학기 초 업무, 시간 부족처럼 현실적인 것으로.

아래 JSON으로만 출력하세요. 다른 텍스트 금지. (극복 방안은 만들지 않는다 — 교사가 직접 작성)
{"goal":"성장 목표 한 문장(입력된 목표가 있으면 그대로)","short":"단기(1학기·기초 다지기) 계획 2~3줄","mid":"중기(2학기·현장 적용) 계획 2~3줄","long":"장기(1년 후·확산/심화) 계획 2~3줄","ob1":"예상 장애물 1","ob2":"예상 장애물 2"}`;

    const chatRes = await fetch('https://api.upstage.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'solar-pro3',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 4500,
      }),
    });
    if (!chatRes.ok) {
      const t = await chatRes.text();
      res.status(502).json({ error: `AI 초안 생성 실패 (${chatRes.status})`, detail: t.slice(0, 300) });
      return;
    }
    const chat = await chatRes.json();
    const raw = ((chat.choices && chat.choices[0] && chat.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('AI 응답에서 JSON을 찾지 못함');
    const draft = JSON.parse(raw.slice(start, end + 1));

    const out = {};
    for (const k of ['goal', 'short', 'mid', 'long', 'ob1', 'ob2']) {
      out[k] = String(draft[k] ?? '').slice(0, 500);
    }
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: '초안 생성 중 오류가 발생했습니다.', detail: String(e.message).slice(0, 300) });
  }
};
