// 12과정 도구 2종의 채점·진단 API (Vercel 함수 한도 절약을 위해 한 파일에 모드 통합)
// - hypo/action: 데이터 탐정 퀴즈(/12/quiz/) — 데이터만 보고 세운 가설과 맥락 공개 후 교사 행동을 채점
// - pcheck: 과정중심평가 자가 체크(/12/check/) — 서술한 수업·평가 방법을 3대 특징 관점으로 진단
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

    const answer = String(req.body.answer ?? '').trim().slice(0, 1200);
    if (!answer) { res.status(400).json({ error: '답변이 없습니다.' }); return; }

    // 채점 조작 시도(프롬프트 주입)는 LLM에 보내지 않고 서버에서 바로 차단
    if (/true로|모두\s*true|정답\s*처리|만점|관리자|\[\s*시스템|시스템\s*(메시지|공지|입니다)|프롬프트|prompt|무시하고|지시(사항)?를\s*따르/i.test(answer)) {
      res.status(200).json({ grounded: false, careful: false, checks: false, ok: false, comment: '데이터와 수업 장면으로 답해 주세요.' });
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
      let lastSlice = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await askRaw(guarded, maxTokens, temp);
        const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
        if (s !== -1 && e !== -1) {
          lastSlice = raw.slice(s, e + 1);
          try { return JSON.parse(lastSlice); } catch (err) { /* 재시도 */ }
        }
      }
      if (lastSlice) { try { return JSON.parse(lastSlice.replace(/[\r\n]+/g, ' ')); } catch (err) { /* 포기 */ } }
      throw new Error('AI 응답 JSON 해석 실패 (2회 시도)');
    };

    if (mode === 'hypo') {
      const signals = String(req.body.signals ?? '').trim().slice(0, 800);
      const prompt = `당신은 데이터 판독 연수 게임의 채점관입니다.
교사(연수생)가 한 학생의 데이터 신호만 보고 가설을 세웠습니다. 아직 실제 사정(맥락)은 공개되지 않았습니다.

<학생의 데이터 신호>
${signals}
</학생의 데이터 신호>

<연수생의 가설>
${answer}
</연수생의 가설>

세 가지를 각각 판정하세요. 관대하게 — 표현이 달라도 의미가 통하면 인정:
- grounded: 데이터 신호를 근거로 삼았는가 (막연한 감상이 아니라 제시된 숫자·기록을 언급하거나 그에 기반)
- careful: 단정·낙인 없이 가설 톤인가 ('게으르다', '문제아다'처럼 학생을 규정하면 false. '~일 수 있다', '~로 보인다', 복수 가능성 제시면 true)
- checks: 판단 전에 추가로 확인할 것(관찰, 대화, 다른 데이터 등)을 제시했는가
- comment: 격려하는 동료 말투 2문장 이내. 잘한 점을 짚고, false인 항목이 있으면 그 이유를 부드럽게. 존댓말.

{"grounded":true 또는 false,"careful":true 또는 false,"checks":true 또는 false,"comment":"..."} JSON으로만 출력. 다른 텍스트 금지.`;
      const d = await ask(prompt, 2200, 0.1);
      res.status(200).json({
        grounded: !!d.grounded, careful: !!d.careful, checks: !!d.checks,
        comment: String(d.comment ?? '').slice(0, 400),
      });
      return;
    }

    if (mode === 'action') {
      const signals = String(req.body.signals ?? '').trim().slice(0, 800);
      const context = String(req.body.context ?? '').trim().slice(0, 800);
      const prompt = `당신은 데이터 판독 연수 게임의 채점관입니다.
데이터 신호만 보이던 학생의 실제 사정(맥락)이 공개되었고, 교사(연수생)가 교사 행동을 적었습니다.

<데이터 신호>
${signals}
</데이터 신호>

<공개된 실제 사정>
${context}
</공개된 실제 사정>

<연수생이 정한 교사 행동>
${answer}
</연수생이 정한 교사 행동>

판정 절차:
1. 공개된 사정이 말하는 학생의 상태(노력·막힘·불가피한 사유·정서적 어려움 등)를 정리한다.
2. 연수생의 행동이 그 상태를 돕는 방향인지 본다. 사정을 반영한 구체적 지원 행동이면 ok=true.
3. 다음은 반드시 ok=false — 일부만 그래도 false: ① 주의·질책·벌·불이익(남아서 더 풀기, 미달 표시, 벌점 등)이 포함된 대응 — 사정이 노력이나 불가피한 사유를 보여줄 때 처벌은 사정을 놓친 것 ② 사정과 무관한 대응 ③ '열심히 지도한다' 같은 막연한 일반론.
comment: 2문장 이내, 존댓말. true면 행동의 좋은 점을 짚고, false면 사정의 어떤 부분과 어긋났는지 알려 줄 것.

{"ok":true 또는 false,"comment":"..."} JSON으로만 출력. 다른 텍스트 금지.`;
      const d = await ask(prompt, 2000, 0.1);
      res.status(200).json({ ok: !!d.ok, comment: String(d.comment ?? '').slice(0, 400) });
      return;
    }

    if (mode === 'pcheck') {
      const prompt = `당신은 초등 과정중심평가에 밝은 수석교사입니다.
교사가 자신의 수업·평가 방법을 설명했습니다. 과정중심평가 관점으로 진단해 주세요.

<교사의 수업·평가 설명>
${answer}
</교사의 수업·평가 설명>

과정중심평가 3대 핵심 특징으로 진단:
① 다각도 수집 — 교수·학습 과정 중에 지식·기능·태도의 변화를 다각도로 수집하는가
② 즉각 피드백 — 수집한 자료로 적절하고 즉각적인 피드백을 주는가
③ 성장 지원 — 평가의 목적이 서열이 아니라 학습 지원과 성장인가
그리고 관찰평가·포트폴리오·동료평가·자기평가가 적재적소에 배치됐는지 확인.

원칙: 설명에 실제로 적힌 것을 근거로. 없는 내용을 지어내지 말고, 설명에 없는 부분은 '설명에 없음'으로 처리.
- strengths: 3대 특징 중 잘 갖춘 것 1~2개와 근거. 줄바꿈(\\n) 구분.
- gaps: 약하거나 설명에 없는 특징과 그 이유. 줄바꿈 구분.
- suggest: 이 수업에 넣기 좋은 평가 방법 배치 제안 2가지 — '언제 무엇을(관찰/포트폴리오/동료/자기평가)' 형태로 구체적으로. 줄바꿈 구분.
- comment: 격려 한마디. 2문장 이내. 존댓말.

{"strengths":"...","gaps":"...","suggest":"...","comment":"..."} JSON으로만 출력. 다른 텍스트 금지.`;
      const d = await ask(prompt, 4200, 0.3);
      res.status(200).json({
        strengths: String(d.strengths ?? '').slice(0, 600),
        gaps: String(d.gaps ?? '').slice(0, 600),
        suggest: String(d.suggest ?? '').slice(0, 600),
        comment: String(d.comment ?? '').slice(0, 300),
      });
      return;
    }

    res.status(400).json({ error: '알 수 없는 mode 입니다.' });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다.', detail: String(e.detail || e.message).slice(0, 300) });
  }
};
