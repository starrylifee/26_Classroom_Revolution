// 13과정 데이터 리터러시 연습: 가상 수업 분석 데이터 생성(scenario) + 교사 해석과 AI 해석 비교(compare)
const UPSTAGE_KEY = process.env.UPSTAGE_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  if (!UPSTAGE_KEY) { res.status(500).json({ error: '서버에 UPSTAGE_API_KEY가 설정되지 않았습니다.' }); return; }

  try {
    const { pw, mode } = req.body || {};
    // 화면 잠금과 별개로 서버에서도 비밀번호를 검사해 무단 API 호출을 막는다
    // 강사용 답안지: 연수생용(tlsekq)과 다른 강사 전용 비밀번호만 통과 (LLM 호출 없음)
    if (mode === 'verify') {
      if (pw === 'tjdnfeo') { res.status(200).json({ ok: true }); return; }
      res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' }); return;
    }
    if (pw !== 'tlsekq') { res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' }); return; }

    const ask = async (prompt, maxTokens, temp) => {
      const r = await fetch('https://api.upstage.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'solar-pro3',
          messages: [{ role: 'user', content: prompt }],
          temperature: temp ?? 0.8,
          max_tokens: maxTokens,
        }),
      });
      if (!r.ok) { const t = await r.text(); throw Object.assign(new Error(`AI 요청 실패 (${r.status})`), { detail: t.slice(0, 300) }); }
      const c = await r.json();
      const raw = ((c.choices && c.choices[0] && c.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
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
      const d = await ask(prompt, 2200);
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

    // 11과정: 사연이 심긴 학급 대시보드 시나리오 생성
    if (mode === 'class_scenario') {
      const seed = String(req.body.seed ?? '').slice(0, 50);
      const prompt = `당신은 교사 연수용 '가상 학급 대시보드' 시나리오를 만드는 설계자입니다.
초등 한 학급(20~26명)의 한 단원 운영 데이터를 만드세요. (변화 시드: ${seed || '무작위'})

원칙:
- 학급에는 서사가 있어야 합니다. "숫자만 보면 틀리게 해석되는 함정"을 정확히 3개 심고, 그 진실은 관찰 메모(memos)에 단서로 남기세요.
  함정 예시: 평균은 무난하지만 특정 영역 양극화 / 히트맵의 학습 공백이 사실은 현장학습 / 정답률 높은데 풀이시간이 비정상적으로 짧은 학생 / 완주율 낮은 학생이 사실은 기기 문제.
- 과목은 초등 국어·수학·과학·사회 중 하나. areas는 그 과목의 성취영역 5개.
- 모든 수치는 초등 현실 범위. 점수 0~100, 시간(분) 0~60(요일별), radar는 1~5.
- students는 6명만 — 주목할 후보(함정 대상 포함)와 평범한 학생을 섞어서. flag는 빈 문자열로.
- memos는 교사 관찰 기록 4개. 함정의 단서를 담되 답을 직접 말하지 말 것.
- traps는 함정 3개의 정답 해설(내부용, 화면에 안 보임).

아래 JSON 스키마로만 출력하세요. 다른 텍스트 금지.
{"context":"4학년 수학 · 3단원 분수 · 24명 · 8주 운영 · 평가 3회","kpi":{"avg":73.2,"delta":-0.9,"ab":58,"study":187,"submit":86},"areas":["수와연산","도형","측정","규칙성","자료와가능성"],"box":[{"area":"수와연산","min":30,"q1":55,"med":72,"q3":85,"max":98}],"trend":[{"area":"수와연산","values":[70,74,72]}],"heat":[[38,42,40,35,41]],"hist":[1,0,2,3,6,8,3,1],"errors":[{"type":"문제 해석 오류","pct":34}],"radar":{"axes":["흥미","자신감","효능감","협력","학업스트레스"],"pre":[3.1,2.8,3.0,3.4,3.2],"post":[3.6,3.2,3.4,3.8,2.9]},"students":[{"id":"학생03","score":95,"time":210,"complete":88,"flag":""}],"memos":["..."],"traps":["..."]}
- box와 trend는 areas 5개 각각 1항목씩(총 5개). heat는 8주×5요일(월~금) 분 단위. hist는 영상 완주율 8구간(0-12.5%부터). errors는 4~5개(pct 합계 100). students 6명.`;
      const d = await ask(prompt, 7000, 0.75);
      // 형태 보정: 필수 구조가 없으면 실패 처리, 수치는 범위로 클램프
      const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
      const out = {
        context: String(d.context ?? '').slice(0, 120),
        kpi: {
          avg: num(d.kpi && d.kpi.avg, 0, 100), delta: num(d.kpi && d.kpi.delta, -30, 30),
          ab: num(d.kpi && d.kpi.ab, 0, 100), study: num(d.kpi && d.kpi.study, 0, 600), submit: num(d.kpi && d.kpi.submit, 0, 100),
        },
        areas: (Array.isArray(d.areas) ? d.areas : []).slice(0, 5).map((a) => String(a).slice(0, 12)),
        box: (Array.isArray(d.box) ? d.box : []).slice(0, 5).map((b) => ({
          area: String((b && b.area) ?? '').slice(0, 12),
          min: num(b && b.min, 0, 100), q1: num(b && b.q1, 0, 100), med: num(b && b.med, 0, 100), q3: num(b && b.q3, 0, 100), max: num(b && b.max, 0, 100),
        })),
        trend: (Array.isArray(d.trend) ? d.trend : []).slice(0, 5).map((t) => ({
          area: String((t && t.area) ?? '').slice(0, 12),
          values: (Array.isArray(t && t.values) ? t.values : []).slice(0, 3).map((v) => num(v, 0, 100)),
        })),
        heat: (Array.isArray(d.heat) ? d.heat : []).slice(0, 8).map((w) => (Array.isArray(w) ? w : []).slice(0, 5).map((v) => num(v, 0, 60))),
        hist: (Array.isArray(d.hist) ? d.hist : []).slice(0, 8).map((v) => num(v, 0, 30)),
        errors: (Array.isArray(d.errors) ? d.errors : []).slice(0, 5).map((e) => ({ type: String((e && e.type) ?? '').slice(0, 20), pct: num(e && e.pct, 0, 100) })),
        radar: {
          axes: (Array.isArray(d.radar && d.radar.axes) ? d.radar.axes : []).slice(0, 5).map((a) => String(a).slice(0, 10)),
          pre: (Array.isArray(d.radar && d.radar.pre) ? d.radar.pre : []).slice(0, 5).map((v) => num(v, 0, 5)),
          post: (Array.isArray(d.radar && d.radar.post) ? d.radar.post : []).slice(0, 5).map((v) => num(v, 0, 5)),
        },
        students: (Array.isArray(d.students) ? d.students : []).slice(0, 6).map((s) => ({
          id: String((s && s.id) ?? '').slice(0, 10), score: num(s && s.score, 0, 100),
          time: num(s && s.time, 0, 600), complete: num(s && s.complete, 0, 100), flag: '',
        })),
        memos: (Array.isArray(d.memos) ? d.memos : []).slice(0, 4).map((m) => String(m).slice(0, 150)),
        traps: (Array.isArray(d.traps) ? d.traps : []).slice(0, 3).map((t) => String(t).slice(0, 200)),
      };
      if (out.areas.length < 5 || out.box.length < 5 || out.trend.length < 5 || out.heat.length < 8 || out.students.length < 6 || out.memos.length < 3) {
        res.status(502).json({ error: 'AI가 학급 데이터를 완전하게 만들지 못했어요. 다시 시도해 주세요.' });
        return;
      }
      res.status(200).json(out);
      return;
    }

    // 11과정: 가이드 판독 — 단계별 학습자 답을 판정하고 힌트/정답을 대화로 제공
    if (mode === 'class_step') {
      const scenario = String(req.body.scenario ?? '').trim().slice(0, 4000);
      const question = String(req.body.question ?? '').trim().slice(0, 300);
      const answer = String(req.body.answer ?? '').trim().slice(0, 600);
      const keyHint = String(req.body.keyHint ?? '').trim().slice(0, 400);
      const reveal = req.body.reveal === true;
      if (!scenario || !question) { res.status(400).json({ error: '단계 정보가 없습니다.' }); return; }
      if (!answer) { res.status(400).json({ error: '답을 먼저 적어 주세요.' }); return; }

      const prompt = `당신은 초등 교사 연수에서 학급 대시보드 판독을 지도하는 수석교사이자 엄격한 채점자입니다. 다정하게 말하되 판정은 냉정하게 합니다.

<학급 대시보드 데이터 (함정 해설 포함, 학습자에게는 안 보임)>
${scenario}
</학급 대시보드 데이터>

지금 단계의 질문: ${question}
이 단계에서 짚어야 할 핵심(채점 기준): ${keyHint || '함정 해설을 참고해 판단'}
학습자의 답: ${answer}

${reveal
  ? '학습자가 두 번 막혔습니다. 이번에는 verdict를 "pass"로 하고, 정답을 근거와 함께 명확히 설명한 뒤 괜찮다고 격려해 주세요. learner_claim에는 학습자의 답 요약을 적으세요.'
  : `판정 절차 — 반드시 이 순서로:
1. 먼저 learner_claim에 학습자의 답이 주장하는 결론을 한 문장으로 요약한다. (답이 무의미하거나 결론이 없으면 "결론 없음")
2. learner_claim을 채점 기준과 비교해 verdict를 정한다.

판정 규칙 (엄격하게 적용):
- 학습자의 결론이 채점 기준과 반대 방향이면 무조건 "retry". (예: 기준은 "개입 불필요"인데 개입하자고 답함, 기준은 "결손 아님"인데 결손이라고 답함)
- 근거 없이 이름·번호·단어만 던진 답은 "retry". 근거(그래프 모양, 관찰 메모, 수치)를 스스로 말해야 "pass".
- 결론과 근거가 모두 채점 기준의 핵심을 짚었을 때만 "pass" — 칭찬하고 정답 요지를 한 문장으로 보강.
- "retry"일 때 reply에는 정답·결론·함정 해설 내용을 한 글자도 담지 말 것. 오직 "어디를 다시 보라"는 안내만 1~2문장. (좋은 예: "관찰 메모 1번을 다시 읽어 보세요." / 나쁜 예: "5주차 공백은 현장체험학습 때문이므로 개입 대상이 아닙니다" ← 정답 유출 금지)
- 애매하면 "retry". "맞습니다" 같은 긍정 표현은 pass일 때만 사용.`}
- reply는 3문장 이내, 존댓말. 훈계하지 말 것.

{"learner_claim":"...","verdict":"pass 또는 retry","reply":"..."} JSON으로만 출력하세요. 다른 텍스트 금지.`;
      const d = await ask(prompt, 1600, 0.1);
      const verdict = d.verdict === 'pass' ? 'pass' : 'retry';
      res.status(200).json({ verdict: reveal ? 'pass' : verdict, reply: String(d.reply ?? '').slice(0, 500) });
      return;
    }

    // 11과정: 교사의 대시보드 해석과 AI 해석 비교
    if (mode === 'class_compare') {
      const scenario = String(req.body.scenario ?? '').trim().slice(0, 4000);
      const individual = String(req.body.individual ?? '').trim().slice(0, 800);
      const classAdj = String(req.body.classAdj ?? '').trim().slice(0, 800);
      if (!scenario) { res.status(400).json({ error: '대시보드 데이터가 없습니다.' }); return; }
      if (!individual && !classAdj) { res.status(400).json({ error: '나의 해석을 먼저 적어 주세요.' }); return; }

      const prompt = `당신은 학급 대시보드를 함께 읽는 수석교사입니다.

<학급 대시보드 데이터 (함정 해설 포함)>
${scenario}
</학급 대시보드 데이터>

<교사의 해석>
개별 지원이 필요한 학생: ${individual || '미입력'}
학급 차원의 수업 조정: ${classAdj || '미입력'}
</교사의 해석>

교사의 해석과 비교해 주세요. 원칙:
- ai_individual: 데이터+관찰 메모를 교차해 개별 지원이 필요한 학생 2~3명과 이유. 줄바꿈(\\n) 구분.
- ai_class: 학급 차원의 수업 조정 지점 2개. 줄바꿈 구분.
- missed: 이 대시보드에 심긴 함정 중 교사가 놓쳤거나 잘못 해석한 것. 교사가 다 찾았다면 그렇다고 인정. 2~3줄.
- comment: 교사 해석에서 좋았던 점 1가지 + 더 생각해 볼 관점 1가지. 동료 관점으로 2~3문장.
- 훈계하지 말고, 데이터의 근거를 함께 제시할 것.

{"ai_individual":"...","ai_class":"...","missed":"...","comment":"..."} JSON으로만 출력하세요. 다른 텍스트 금지.`;
      const d = await ask(prompt, 3000, 0.4);
      res.status(200).json({
        ai_individual: String(d.ai_individual ?? '').slice(0, 700),
        ai_class: String(d.ai_class ?? '').slice(0, 500),
        missed: String(d.missed ?? '').slice(0, 500),
        comment: String(d.comment ?? '').slice(0, 400),
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
      const d = await ask(prompt, 2800);
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
