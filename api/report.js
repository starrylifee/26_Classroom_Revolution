// 11과정 학급 데이터 분석 보고서: 초안(draft)은 줄 단위 출력·파싱(긴 JSON 배열 깨짐 방지), 점검(review)은 소형 JSON.
const UPSTAGE_KEY = process.env.UPSTAGE_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  if (!UPSTAGE_KEY) { res.status(500).json({ error: '서버에 UPSTAGE_API_KEY가 설정되지 않았습니다.' }); return; }

  try {
    const { pw, mode } = req.body || {};
    // 화면 잠금과 별개로 서버에서도 비밀번호를 검사해 무단 API 호출을 막는다
    if (pw !== 'tlsekq') { res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' }); return; }
    if (mode === 'verify') { res.status(200).json({ ok: true }); return; }

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

    if (mode === 'draft') {
      const overview = String(req.body.overview ?? '').trim().slice(0, 500);
      const memo = String(req.body.memo ?? '').trim().slice(0, 2500);
      if (!memo) { res.status(400).json({ error: '차트에서 본 것을 먼저 메모해 주세요.' }); return; }

      const prompt = `당신은 초등 학습 데이터 분석에 밝은 수석교사입니다.
한 교사가 학급 데이터를 분석해 보고서를 쓰려고 합니다. 아래는 교사가 적은 개요와, 차트를 보며 남긴 메모입니다.

<데이터 개요>
${overview || '(미입력)'}
</데이터 개요>

<차트에서 본 것 메모>
${memo}
</차트에서 본 것 메모>

메모를 바탕으로 보고서 초안을 만드세요. 원칙:
- 메모에 실제로 있는 내용만 쓸 것. 메모에 없는 수치·학생을 지어내지 말 것. 메모가 부족한 칸은 "메모에 없음 — 직접 확인 필요"라고 쓸 것.
- 학생은 반드시 번호·익명(학생07 등)으로만. 해석은 단정보다 가설 톤("~로 보인다", "~일 수 있다")으로.
- 출력은 [섹션] 표시 아래 내용 줄만. 각 줄은 항목을 " :: " 로 구분. 라벨·번호·불릿·예시 문구 금지, 실제 내용만 쓸 것.

[학급분석] ← 3줄. 각 줄 = 실제 차트 이름 :: 차트가 보여준 사실 :: 그 해석. 이런 식으로: 성취영역 상자그림 :: 도형 상자가 길고 아래 수염이 28점까지 내려감 :: 평균 뒤에 하위권 뭉치가 있는 양극화로 보임
[개별지원] ← 최대 3줄(메모에 있는 학생만). 각 줄 = 학생번호 :: 신호가 된 데이터 :: 해석 :: 지원 계획. 이런 식으로: 학생07 :: 학습시간 최다인데 44점, 표정 어두움 메모 :: 노력 대비 성취가 낮고 정서 신호가 있음 :: 학습 방법 점검과 상담을 병행
[수업조정] ← 2줄. 각 줄 = 조정할 지점 :: 데이터 근거 :: 실행 방법
[환류] ← 2줄. 각 줄 = 다음 차시·단원에서 실행할 것 :: 그 효과를 확인할 데이터. 이런 식으로: 지문 읽기 단계 지도 도입 :: 다음 회차 형성평가의 문제 해석 오류 비율 변화
[성찰] ← 1줄. 수치와 맥락을 종합한 교사 판단 2~3문장을 한 줄로`;

      const raw = await askRaw(prompt, 5000, 0.4);
      // 줄 단위 파싱
      const sections = { '학급분석': [], '개별지원': [], '수업조정': [], '환류': [], '성찰': [] };
      let cur = null;
      raw.split('\n').forEach((line) => {
        const t = line.trim();
        if (!t) return;
        const m = t.match(/^\[(학급분석|개별지원|수업조정|환류|성찰)\]/);
        if (m) { cur = m[1]; return; }
        if (!cur) return;
        if (/^\(/.test(t) || /^(이런 식으로|예\s*[:)])/.test(t)) return; // 안내·예시 줄 무시
        if (/^(근거\s*차트|학생\s*번호|조정\s*지점|다음 차시)/.test(t) && t.includes('::') === false) return; // 라벨 줄 무시
        sections[cur].push(t.replace(/^[-•\d.)\s]+/, ''));
      });
      const split = (line, n) => {
        const parts = line.split(/\s*::\s*/).map((s) => s.trim());
        while (parts.length < n) parts.push('');
        return parts.slice(0, n).map((s) => s.slice(0, 300));
      };
      const analysis = sections['학급분석'].slice(0, 3).map((l) => split(l, 3));
      const individual = sections['개별지원'].slice(0, 3).map((l) => split(l, 4));
      const adjust = sections['수업조정'].slice(0, 2).map((l) => split(l, 3));
      const flow = sections['환류'].slice(0, 2).map((l) => split(l, 2));
      const reflect = sections['성찰'].join(' ').slice(0, 600);
      if (!analysis.length && !reflect) throw new Error('AI 응답 형식 해석 실패');
      res.status(200).json({ analysis, individual, adjust, flow, reflect });
      return;
    }

    if (mode === 'review') {
      const report = String(req.body.report ?? '').trim().slice(0, 6000);
      if (report.length < 100) { res.status(400).json({ error: '점검할 보고서 내용이 너무 짧습니다.' }); return; }

      const prompt = `당신은 초등 학습 데이터 분석 보고서를 검토하는 수석교사입니다.
아래는 교사가 제출 전에 점검을 요청한 학급 데이터 분석 보고서입니다.

<보고서>
${report}
</보고서>

'수치 → 맥락 → 판단' 교차 검증 관점으로 점검하세요. 확인할 것:
- 데이터(차트) 근거 없이 주장만 있는 곳
- 수치만 나열하고 해석이 없는 곳
- 일시적 신호를 영구적 특성으로 단정한 곳(과잉 일반화)
- 데이터만으로 학생을 낙인찍는 표현('게으르다', '산만하다', '문제아' 등) — 반드시 지적하고 행동·데이터 중심 표현으로 바꾸게 할 것
- 개별 지원과 학급 조정이 뒤섞이거나 겹치는 곳
- 환류 계획에 검증 방법(무슨 데이터로 확인할지)이 빠졌는지
- 학생 실명이 있으면 반드시 지적

원칙: 보고서에 실제로 적힌 내용을 인용(「」)해 지적하고, 없는 내용을 지어내지 말 것. 잘한 점 먼저.
- praise: 잘한 점 2가지. 줄바꿈(\\n) 구분.
- issues: 보완할 점 2~3가지 — 각각 '어디가(인용) → 어떻게 고칠지'. 줄바꿈 구분. 문제 없으면 '제출해도 좋습니다'.
- comment: 격려 한마디. 2문장 이내. 존댓말.

{"praise":"...","issues":"...","comment":"..."} JSON으로만 출력하세요. 다른 텍스트 금지.
(JSON 문자열 값 안에서는 큰따옴표를 쓰지 말 것 — 인용은 「」 사용)`;

      let d = null, lastSlice = '';
      for (let attempt = 0; attempt < 2 && !d; attempt++) {
        const raw = await askRaw(prompt, 4500, 0.3);
        const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
        if (s !== -1 && e !== -1) {
          lastSlice = raw.slice(s, e + 1);
          try { d = JSON.parse(lastSlice); } catch (err) { /* 재시도 */ }
        }
      }
      if (!d && lastSlice) { try { d = JSON.parse(lastSlice.replace(/[\r\n]+/g, ' ')); } catch (err) { /* 포기 */ } }
      if (!d) throw new Error('AI 응답 JSON 해석 실패 (2회 시도)');
      res.status(200).json({
        praise: String(d.praise ?? '').slice(0, 600),
        issues: String(d.issues ?? '').slice(0, 900),
        comment: String(d.comment ?? '').slice(0, 300),
      });
      return;
    }

    res.status(400).json({ error: '알 수 없는 mode 입니다.' });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다.', detail: String(e.detail || e.message).slice(0, 300) });
  }
};
