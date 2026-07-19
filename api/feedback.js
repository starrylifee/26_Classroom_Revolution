// 12과정 환류 설계: 피드백 리허설 점검(coach) + 환류 전략 템플릿 초안(template)
const UPSTAGE_KEY = process.env.UPSTAGE_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  if (!UPSTAGE_KEY) { res.status(500).json({ error: '서버에 UPSTAGE_API_KEY가 설정되지 않았습니다.' }); return; }

  try {
    const { pw, mode } = req.body || {};
    // 화면 잠금과 별개로 서버에서도 비밀번호를 검사해 무단 API 호출을 막는다
    if (pw !== 'tlsekq') { res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' }); return; }

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
    // JSON 값 속 큰따옴표가 파싱을 깨는 경우가 있어 지시 추가 + 실패 시 1회 재시도
    const ask = async (prompt, maxTokens, temp) => {
      const guarded = prompt + '\n(JSON 문자열 값 안에서는 큰따옴표를 쓰지 말 것 — 인용이 필요하면 작은따옴표나 「」 사용)';
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await askRaw(guarded, maxTokens, temp);
        const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
        if (s !== -1 && e !== -1) { try { return JSON.parse(raw.slice(s, e + 1)); } catch (err) { /* 재시도 */ } }
      }
      throw new Error('AI 응답 JSON 해석 실패 (2회 시도)');
    };

    if (mode === 'coach') {
      const student = String(req.body.student ?? '').trim().slice(0, 500);
      const rapport = String(req.body.rapport ?? '').trim().slice(0, 500);
      const feedup = String(req.body.feedup ?? '').trim().slice(0, 500);
      const feedback = String(req.body.feedback ?? '').trim().slice(0, 500);
      const feedforward = String(req.body.feedforward ?? '').trim().slice(0, 500);
      if (!student) { res.status(400).json({ error: '학생 소개를 먼저 적어 주세요.' }); return; }
      if (!rapport && !feedup && !feedback && !feedforward) { res.status(400).json({ error: '피드백을 한 칸이라도 먼저 적어 주세요.' }); return; }

      const prompt = `당신은 존 해티(John Hattie)의 피드백 모델에 밝은 수석교사입니다.
한 교사가 우리 반 학생에게 줄 피드백을 리허설하고 있습니다.

<학생 소개>
${student}
</학생 소개>
<교사가 작성한 피드백>
라포·긍정적 시작: ${rapport || '(비어 있음)'}
Feed-Up (목표 상기): ${feedup || '(비어 있음)'}
Feed-Back (현재 상태 진단): ${feedback || '(비어 있음)'}
Feed-Forward (다음 단계 제시): ${feedforward || '(비어 있음)'}
</교사가 작성한 피드백>

좋은 피드백 원칙으로 점검해 주세요.
- 원칙: ① 라포 — 추궁이 아닌 존중·지지의 어조인가, 실제 성과를 구체적으로 인정했는가 ② 진단 — 비난 없이 객관적 원인을 짚었는가 ③ 우선순위 — 한 번에 하나만 다루는가 ④ 다음 단계 — 과제를 작게 쪼갠 실행 가능한 미션인가
- checks: 위 4가지 원칙별 점검 코멘트. 각 한 줄, "① 라포: ..." 형식으로 줄바꿈(\\n) 구분. 잘한 점은 인정하고, 아쉬운 점은 이유와 함께.
- revised: 네 단계를 이어 붙인, 교사가 학생에게 실제로 말하듯 다듬은 피드백 스크립트. 교사가 쓴 표현을 최대한 살리고, 빈 칸은 학생 소개에 근거해 보완. 6문장 이내.
- caution: 이 학생에게 피드백할 때 특히 조심할 점 1가지. 30자 내외.

{"checks":"...","revised":"...","caution":"..."} JSON으로만 출력하세요. 다른 텍스트 금지.`;
      const d = await ask(prompt, 3000, 0.4);
      res.status(200).json({
        checks: String(d.checks ?? '').slice(0, 700),
        revised: String(d.revised ?? '').slice(0, 800),
        caution: String(d.caution ?? '').slice(0, 200),
      });
      return;
    }

    if (mode === 'template') {
      const findings = String(req.body.findings ?? '').trim().slice(0, 800);
      const student = String(req.body.student ?? '').trim().slice(0, 500);
      const fbPlan = String(req.body.fbPlan ?? '').trim().slice(0, 800);
      if (!findings && !student) { res.status(400).json({ error: '데이터에서 발견한 내용을 먼저 적어 주세요.' }); return; }

      const prompt = `당신은 초등 교사의 평가 결과 기반 환류 설계를 돕는 컨설턴트입니다.

<데이터에서 발견한 것 (교사 메모)>
${findings || '없음'}
</데이터에서 발견한 것>
<개별 지원 학생>
${student || '없음'}
</개별 지원 학생>
<피드백 리허설 내용>
${fbPlan || '없음'}
</피드백 리허설 내용>

환류 전략 템플릿 초안을 작성해 주세요. 원칙:
- interpret: 학생들의 학습 상태를 데이터 기반으로 해석한 내용 2~3줄. 교사 메모의 표현을 살릴 것.
- plan: 나의 피드백 계획 2~3줄 — 개별 학생(있다면)과 학급 전체를 나눠서, 적시성·우선순위를 담아.
- revise: 나의 수업 수정 전략 2~3줄 — 다음 차시·단원에서 바꿀 구체적 행동으로.
- reflect: 교육적 성찰 2줄 — 이번 데이터 해석 과정에서 교사로서 배운 점.
- 각 항목 줄바꿈(\\n) 구분. 메모에 없는 내용을 지어내지 말고, 근거가 부족하면 짧게.

{"interpret":"...","plan":"...","revise":"...","reflect":"..."} JSON으로만 출력하세요. 다른 텍스트 금지.`;
      const d = await ask(prompt, 2800, 0.4);
      res.status(200).json({
        interpret: String(d.interpret ?? '').slice(0, 600),
        plan: String(d.plan ?? '').slice(0, 600),
        revise: String(d.revise ?? '').slice(0, 600),
        reflect: String(d.reflect ?? '').slice(0, 400),
      });
      return;
    }

    res.status(400).json({ error: '알 수 없는 mode 입니다.' });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다.', detail: String(e.detail || e.message).slice(0, 300) });
  }
};
