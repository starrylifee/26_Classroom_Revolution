// 10과정 바이브코딩 기획서: 수업 정보·기록 대상만 적으면 기록 설계·화면·산출물 초안을 채워 준다.
// 최종 프롬프트 조립은 프런트에서 로컬로 처리 — 이 API는 초안 제안만 담당.
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
    if (mode !== 'draft') { res.status(400).json({ error: '알 수 없는 mode 입니다.' }); return; }

    const lesson = String(req.body.lesson ?? '').trim().slice(0, 800);
    const target = String(req.body.target ?? '').trim().slice(0, 800);
    if (!lesson && !target) { res.status(400).json({ error: '수업 정보나 기록하고 싶은 것을 먼저 적어 주세요.' }); return; }

    const prompt = `당신은 초등 과정중심평가와 에듀테크에 밝은 수석교사입니다.
한 교사가 '수업 중 휘발되는 과정 데이터를 기록하는 웹앱'을 바이브코딩으로 만들려고 기획서를 쓰고 있습니다. 교사가 적은 내용은 아래가 전부입니다.

<수업 정보>
${lesson || '(비어 있음)'}
</수업 정보>

<기록하고 싶은 과정 데이터>
${target || '(비어 있음)'}
</기록하고 싶은 과정 데이터>

이 수업과 기록 대상에 딱 맞는 기획서 초안을 채워 주세요. 원칙:
- 교사가 적은 수업·기록 대상에 맞춰 구체적으로. 일반론 금지. 교사가 적은 내용과 무관한 것을 지어내지 말 것.
- fields: 기록 항목 3~5개. '항목명(입력 형태)' 꼴로 줄바꿈(\\n) 구분. 예: 오늘 내가 맡은 역할(선택형), 어려웠던 점 한 줄(짧은 글).
- who: 입력 주체와 이유 1문장. (학생 스스로 / 교사 / 둘 다 중에서)
- when: 입력 시점 1문장. 수업 흐름 속 어느 순간인지 구체적으로.
- how: 입력 부담을 줄이는 방식 1~2문장. (별점·이모지 선택·한 줄 글 등 1분 안에 끝나는 방식)
- studentView: 학생 화면에 보일 것 2~3가지. 줄바꿈 구분.
- teacherView: 교사 화면에 보일 것 2~3가지 (누가 입력했는지 한눈에, 누적 추이 등). 줄바꿈 구분.
- output: 산출물 제안 1~2문장. (PNG 카드·PDF 보고서·CSV 중 이 수업에 맞는 것과 그 쓰임새 — 생활기록부 참고, 학부모 상담, 포트폴리오 등)
- 학생 이름 대신 번호·별칭을 쓰는 개인정보 원칙을 studentView나 how 어딘가에 자연스럽게 반영할 것.

{"fields":"...","who":"...","when":"...","how":"...","studentView":"...","teacherView":"...","output":"..."} JSON으로만 출력하세요. 다른 텍스트 금지.`;

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
    // solar-pro3는 추론(<think>) 토큰을 많이 쓰므로 출력 여유를 크게 잡는다
    let d = null, lastSlice = '';
    for (let attempt = 0; attempt < 2 && !d; attempt++) {
      const raw = await askRaw(prompt + JSON_NOTE + '\n(문자열 값 안의 줄바꿈은 반드시 \\n 두 글자로 쓸 것 — 실제 줄바꿈 금지)', 6000, 0.4);
      const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        lastSlice = raw.slice(s, e + 1);
        try { d = JSON.parse(lastSlice); } catch (err) { /* 재시도 */ }
      }
    }
    // 마지막 방어: 문자열 안 실제 줄바꿈 때문에 깨진 경우 공백으로 눌러 다시 시도
    if (!d && lastSlice) { try { d = JSON.parse(lastSlice.replace(/[\r\n]+/g, ' ')); } catch (err) { /* 포기 */ } }
    if (!d) throw new Error('AI 응답 JSON 해석 실패 (2회 시도)');

    res.status(200).json({
      fields: String(d.fields ?? '').slice(0, 600),
      who: String(d.who ?? '').slice(0, 300),
      when: String(d.when ?? '').slice(0, 300),
      how: String(d.how ?? '').slice(0, 400),
      studentView: String(d.studentView ?? '').slice(0, 500),
      teacherView: String(d.teacherView ?? '').slice(0, 500),
      output: String(d.output ?? '').slice(0, 400),
    });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다.', detail: String(e.detail || e.message).slice(0, 300) });
  }
};
