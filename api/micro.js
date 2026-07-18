// 10과정 마이크로티칭 도우미: 학생 페르소나 행동 시나리오(persona) + 관찰 피드백 종합(synthesize)
const UPSTAGE_KEY = process.env.UPSTAGE_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  if (!UPSTAGE_KEY) { res.status(500).json({ error: '서버에 UPSTAGE_API_KEY가 설정되지 않았습니다.' }); return; }

  try {
    const { pw, mode } = req.body || {};
    // 화면 잠금과 별개로 서버에서도 비밀번호를 검사해 무단 API 호출을 막는다
    if (pw !== 'tlsekq') { res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' }); return; }

    const ask = async (prompt, maxTokens, temp) => {
      const r = await fetch('https://api.upstage.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'solar-pro2',
          messages: [{ role: 'user', content: prompt }],
          temperature: temp,
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

    if (mode === 'persona') {
      const traits = String(req.body.traits ?? '').trim().slice(0, 200);
      if (!traits) { res.status(400).json({ error: '페르소나 특성이 없습니다.' }); return; }

      const prompt = `당신은 초등 수업 시연(마이크로티칭)을 돕는 연수 퍼실리테이터입니다.
연수생이 '학생 역할'을 연기할 학생 페르소나가 뽑혔습니다.

- 페르소나 특성: ${traits}

이 학생이 AI·디지털 활용 수업 중에 보일 법한 모습을 만들어 주세요. 원칙:
- behaviors: 수업 장면에서 보일 구체적 행동 3가지. 연수생이 바로 연기할 수 있게 대사나 행동으로. 각 30자 내외, 줄바꿈(\\n) 구분.
- tip: 시연 교사가 이 학생을 만났을 때 시도해 볼 대응 힌트 1가지 (참여 촉진·상호작용·평가 관점에서). 40자 내외.
- 과장된 문제아 캐릭터로 만들지 말 것. 실제 교실에 있을 법한 수준으로.

{"behaviors":"...","tip":"..."} JSON으로만 출력하세요. 다른 텍스트 금지.`;
      const d = await ask(prompt, 500, 0.8);
      res.status(200).json({
        behaviors: String(d.behaviors ?? '').slice(0, 400),
        tip: String(d.tip ?? '').slice(0, 200),
      });
      return;
    }

    if (mode === 'synthesize') {
      const feedbacks = String(req.body.feedbacks ?? '').trim().slice(0, 6000);
      if (!feedbacks) { res.status(400).json({ error: '붙여넣은 관찰 기록이 없습니다.' }); return; }

      const prompt = `당신은 마이크로티칭(수업 시연)을 마친 교사의 동료 피드백을 종합하는 수석교사입니다.
아래는 관찰자들이 보낸 관찰 기록입니다. (참여=학생 참여 촉진, 상호=교사-학생-AI 상호작용, 평가=데이터 기반 평가. 각 1~5점)

<관찰 기록 모음>
${feedbacks}
</관찰 기록 모음>

기록을 종합해 주세요. 원칙:
- strengths: 관찰자들이 공통으로 칭찬한 지점 2~3개. 근거 표현을 살려서. 줄바꿈(\\n) 구분.
- improvements: 공통으로 지적된 보완점 2~3개. 관찰자가 제안한 대안을 포함해서. 줄바꿈 구분.
- revisions: 이 피드백을 수업설계안에 반영하는 구체적 보완 제안 3가지. "설계안의 ~단계에 ~을 추가/수정"처럼 실행 가능하게. 줄바꿈 구분.
- comment: 점수가 낮은 영역을 짚되 격려하는 동료 관점의 한마디. 2문장 이내.
- 기록에 없는 내용을 지어내지 말 것.

{"strengths":"...","improvements":"...","revisions":"...","comment":"..."} JSON으로만 출력하세요. 다른 텍스트 금지.`;
      const d = await ask(prompt, 900, 0.4);
      res.status(200).json({
        strengths: String(d.strengths ?? '').slice(0, 600),
        improvements: String(d.improvements ?? '').slice(0, 600),
        revisions: String(d.revisions ?? '').slice(0, 600),
        comment: String(d.comment ?? '').slice(0, 300),
      });
      return;
    }

    res.status(400).json({ error: '알 수 없는 mode 입니다.' });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다.', detail: String(e.detail || e.message).slice(0, 300) });
  }
};
