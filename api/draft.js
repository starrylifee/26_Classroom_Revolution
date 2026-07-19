// 수업 설계안 파일을 받아 9과정 학습지 6종의 초안(표 셀 값)을 생성한다.
const UPSTAGE_KEY = process.env.UPSTAGE_API_KEY;

// 표별 [행 수, 열 수] — 프런트와 template.hwpx 자리표시자에 맞춰야 한다.
const SHAPES = { g: [5, 6], s: [3, 5], t: [7, 5], e: [5, 4], p: [5, 3], c: [4, 8], q: [4, 8] };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  if (!UPSTAGE_KEY) { res.status(500).json({ error: '서버에 UPSTAGE_API_KEY가 설정되지 않았습니다.' }); return; }

  try {
    const { filename, mime, data, pw } = req.body || {};
    // 화면 잠금과 별개로 서버에서도 비밀번호를 검사해 무단 API 호출을 막는다
    if (pw !== 'tlsekq') { res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' }); return; }
    if (!filename || !data) { res.status(400).json({ error: '파일 데이터가 없습니다.' }); return; }

    // 1) Document Parse
    const buf = Buffer.from(data, 'base64');
    const form = new FormData();
    form.append('document', new Blob([buf], { type: mime || 'application/octet-stream' }), filename);
    form.append('model', 'document-parse');
    form.append('output_formats', '["markdown"]');
    const parseRes = await fetch('https://api.upstage.ai/v1/document-digitization', {
      method: 'POST', headers: { Authorization: `Bearer ${UPSTAGE_KEY}` }, body: form,
    });
    if (!parseRes.ok) {
      const t = await parseRes.text();
      res.status(502).json({ error: `문서 분석 실패 (${parseRes.status})`, detail: t.slice(0, 300) });
      return;
    }
    const parsed = await parseRes.json();
    const markdown = (parsed.content && parsed.content.markdown) || '';
    if (markdown.trim().length < 30) {
      res.status(422).json({ error: '문서에서 텍스트를 거의 읽지 못했습니다.' });
      return;
    }

    // 2) Solar: 학습지 초안 생성
    const prompt = `당신은 초등 AI·디지털 수업 설계 전문가입니다.
아래는 교사가 제출한 수업 설계안입니다.

<수업설계안>
${markdown.slice(0, 15000)}
</수업설계안>

이 설계안을 근거로 '데이터 기반 수업 점검 학습지' 초안을 작성하세요.
설계안에 있는 활동·도구를 우선 사용하고, 설계안에 없는 부분은 초등 수업에서 자연스러운 내용으로 보완하되 과장하지 마세요.
모든 칸은 학습지에 손글씨 대신 들어갈 짧은 명사구(2~15자)로 씁니다. 문장으로 길게 쓰지 마세요.

7개 표를 아래 JSON으로만 출력하세요. 각 표는 2차원 배열(행×열)이며 행·열 수를 정확히 지키세요.

"g" (5행×6열) 수업 단계별 데이터 감사표. 행 순서: 도입, 전개1, 전개2, 정리, 기타. 열: 활동 내용 | 사용 도구 | 남는 데이터 | 데이터를 보는 시점 | 해석 기준 | 교사 행동.
  예시 행: ["진단 퀴즈 5문항","띵커벨","정답률, 응답속도","5분","같은 오답 30% 이상","전체 멈춤 후 2분 재설명"]
"s" (3행×5열) 예상 데이터 신호. 열: 데이터 신호 | 가능한 해석 1 | 가능한 해석 2 | 추가 확인 데이터 | 교사 행동.
  예시 행: ["정답률 90%, 응답 4초","이해함","찍기, 쉬운 문항만 풂","풀이 과정, 변형문항","변형문항 1개 투입"]
"t" (7행×5열) 시간대별 흐름. 행 순서(시간 고정): 0~2분, 2~5분, 5~10분, 10~15분, 15~20분, 20~30분, 30~40분. 열: 학생 활동 | AI·디지털 도구 | 남는 데이터 | 교사 확인 시점 | 교사 행동.
"e" (5행×4열) 평가 증거. 행 순서: 개념 이해, 문제 해결 과정, 협업·소통, 자기성찰, 도구 활용. 열: 증거가 남는 지점 | 남는 데이터·산출물 | 루브릭 채점 근거 | 보완 필요.
"p" (5행×3열) 페르소나 점검. 행 순서: 빠른 학습자, 느린 학습자, 이탈 학습자, 특수교육대상 학생, 기기·네트워크 문제. 열: 막히는 지점 | 왜 위험한가 | 수정 제안.
"c" (4행×8열) 15분 크래시 테스트. 행 순서(시간 고정): 0~2분, 2~7분, 7~12분, 12~15분. 열: 학습 단계 | 학생 활동 | AI·도구/데이터 | 데이터 확인 시점 | IF–THEN–DO | 교사 행동 | 평가 증거 | Plan B.
  예시 행: ["진단","퀴즈 5문항","정답률·응답속도","5분","같은 오답 30%↑이면","전체 2분 재설명","진단 결과","손들기 퀴즈"]
"q" (4행×8열) 마이크로티칭 큐시트. 구조는 "c"와 동일하되, 크래시 테스트에서 발견될 문제를 보완한 최종 실행 버전으로 작성.

{"g":[...], "s":[...], "t":[...], "e":[...], "p":[...], "c":[...], "q":[...]}
JSON 외 다른 텍스트는 출력하지 마세요.`;

    const chatRes = await fetch('https://api.upstage.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTAGE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'solar-pro3',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 5000,
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

    // 형태 보정: 행·열 수를 강제로 맞춘다 (부족하면 빈칸, 넘치면 자름)
    const out = {};
    for (const [key, [rows, cols]] of Object.entries(SHAPES)) {
      const src = Array.isArray(draft[key]) ? draft[key] : [];
      out[key] = Array.from({ length: rows }, (_, r) => {
        const row = Array.isArray(src[r]) ? src[r] : [];
        return Array.from({ length: cols }, (_, c) => String(row[c] ?? '').slice(0, 120));
      });
    }
    out.pages = (parsed.usage && parsed.usage.pages) || null;
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: '초안 생성 중 오류가 발생했습니다.', detail: String(e.message).slice(0, 300) });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};
