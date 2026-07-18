// 13과정: 자가 진단·스윗 스팟을 받아 성장 로드맵(단기/중기/장기)과 걸림돌 초안을 생성한다.
const UPSTAGE_KEY = process.env.UPSTAGE_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  if (!UPSTAGE_KEY) { res.status(500).json({ error: '서버에 UPSTAGE_API_KEY가 설정되지 않았습니다.' }); return; }

  try {
    const { pw, mode, scores, strong, weak, need, want, goal } = req.body || {};
    // 화면 잠금과 별개로 서버에서도 비밀번호를 검사해 무단 API 호출을 막는다
    if (pw !== 'tlsekq') { res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' }); return; }

    // mode 'goal': Need×Want를 연결한 성장 목표 한 문장만 생성
    if (mode === 'goal') {
      const gPrompt = `당신은 교사의 AI·디지털 역량 개발을 돕는 연수 컨설턴트입니다.

- 학생의 필요(Need): ${String(need || '').slice(0, 300)}
- 교사의 흥미(Want): ${String(want || '').slice(0, 300)}
- 보완이 필요한 역량: ${String(weak || '').slice(0, 100) || '미입력'}

Want를 수단으로, Need 해결을 목적으로 연결한 '최우선 성장 목표'를 한 문장으로 만드세요.
형식 예시: "생성형 AI를 활용해 느린 학습자 맞춤 문제를 만드는 교사 되기 (C·F 역량 보완)"
- "~하는 교사 되기" 꼴로 끝내고, 보완 역량이 있으면 괄호로 덧붙일 것.
- 40자 내외, 교사가 바로 포트폴리오에 옮겨 적을 수 있는 자연스러운 한국어로.

{"goal":"..."} JSON으로만 출력하세요. 다른 텍스트 금지.`;
      const gRes = await fetch('https://api.upstage.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'solar-pro2',
          messages: [{ role: 'user', content: gPrompt }],
          temperature: 0.5,
          max_tokens: 300,
        }),
      });
      if (!gRes.ok) {
        const t = await gRes.text();
        res.status(502).json({ error: `AI 문장 생성 실패 (${gRes.status})`, detail: t.slice(0, 300) });
        return;
      }
      const gChat = await gRes.json();
      const gRaw = (gChat.choices && gChat.choices[0] && gChat.choices[0].message.content) || '';
      const gs = gRaw.indexOf('{');
      const ge = gRaw.lastIndexOf('}');
      if (gs === -1 || ge === -1) throw new Error('AI 응답에서 JSON을 찾지 못함');
      const gDraft = JSON.parse(gRaw.slice(gs, ge + 1));
      res.status(200).json({ goal: String(gDraft.goal ?? '').slice(0, 200) });
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

아래 JSON으로만 출력하세요. 다른 텍스트 금지.
{"goal":"성장 목표 한 문장(입력된 목표가 있으면 그대로)","short":"단기(1학기·기초 다지기) 계획 2~3줄","mid":"중기(2학기·현장 적용) 계획 2~3줄","long":"장기(1년 후·확산/심화) 계획 2~3줄","ob1":"예상 장애물 1","sol1":"극복 방안 1","ob2":"예상 장애물 2","sol2":"극복 방안 2"}`;

    const chatRes = await fetch('https://api.upstage.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'solar-pro2',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 1500,
      }),
    });
    if (!chatRes.ok) {
      const t = await chatRes.text();
      res.status(502).json({ error: `AI 초안 생성 실패 (${chatRes.status})`, detail: t.slice(0, 300) });
      return;
    }
    const chat = await chatRes.json();
    const raw = (chat.choices && chat.choices[0] && chat.choices[0].message.content) || '';
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('AI 응답에서 JSON을 찾지 못함');
    const draft = JSON.parse(raw.slice(start, end + 1));

    const out = {};
    for (const k of ['goal', 'short', 'mid', 'long', 'ob1', 'sol1', 'ob2', 'sol2']) {
      out[k] = String(draft[k] ?? '').slice(0, 500);
    }
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: '초안 생성 중 오류가 발생했습니다.', detail: String(e.message).slice(0, 300) });
  }
};
