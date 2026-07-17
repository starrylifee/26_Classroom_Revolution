// 수업 설계안 파일을 받아 Upstage Document Parse로 텍스트를 추출하고
// Solar LLM으로 5가지 핵심 원리 점수를 평가해 반환한다.
const UPSTAGE_KEY = process.env.UPSTAGE_API_KEY;

const LABELS = [
  '학습자 주도성',
  '의미 있는 과제',
  '구조화된 상호작용',
  '가시적 학습·즉각 피드백',
  '개별화·맞춤형 지원',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 지원합니다.' });
    return;
  }
  if (!UPSTAGE_KEY) {
    res.status(500).json({ error: '서버에 UPSTAGE_API_KEY가 설정되지 않았습니다.' });
    return;
  }

  try {
    const { filename, mime, data } = req.body || {};
    if (!filename || !data) {
      res.status(400).json({ error: '파일 데이터가 없습니다.' });
      return;
    }

    // 1) Document Parse: 파일 → 마크다운
    const buf = Buffer.from(data, 'base64');
    const form = new FormData();
    form.append('document', new Blob([buf], { type: mime || 'application/octet-stream' }), filename);
    form.append('model', 'document-parse');
    form.append('output_formats', '["markdown"]');

    const parseRes = await fetch('https://api.upstage.ai/v1/document-digitization', {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTAGE_KEY}` },
      body: form,
    });
    if (!parseRes.ok) {
      const t = await parseRes.text();
      res.status(502).json({ error: `문서 분석 실패 (${parseRes.status})`, detail: t.slice(0, 300) });
      return;
    }
    const parsed = await parseRes.json();
    const markdown = (parsed.content && parsed.content.markdown) || '';
    if (markdown.trim().length < 30) {
      res.status(422).json({ error: '문서에서 텍스트를 거의 읽지 못했습니다. 내용이 있는 파일인지 확인해 주세요.' });
      return;
    }

    // 2) Solar LLM: 5가지 원리 평가
    const prompt = `당신은 초등 교육공학·수업 설계 전문가입니다.
아래는 교사가 제출한 수업 설계안에서 추출한 내용입니다.

<수업설계안>
${markdown.slice(0, 18000)}
</수업설계안>

이 설계안을 '학생 참여형 수업의 5가지 핵심 원리'로 평가하세요. 각 원리마다 0~10점 정수 점수를 매기고, 설계안에 실제로 적힌 활동·도구·평가 내용을 근거로 제시해야 합니다. 설계안에 없는 내용을 지어내지 마세요.

원리:
1. ${LABELS[0]} — 학생이 스스로 질문·선택·계획하는가
2. ${LABELS[1]} — 실생활 연계, 학습 목표와 정합적인 과제인가
3. ${LABELS[2]} — 협력·토의 등 상호작용이 구조화되어 있는가
4. ${LABELS[3]} — 학습 과정이 가시화되고 즉각 피드백이 있는가
5. ${LABELS[4]} — 수준·속도에 맞는 개별화 지원이 있는가

반드시 아래 JSON 형식으로만 답하세요. 다른 텍스트는 쓰지 마세요.
{
  "scores": [점수1, 점수2, 점수3, 점수4, 점수5],
  "generalFeedback": "종합 평가 3~4문장. 강점 먼저, 보완점 다음. 존댓말.",
  "details": [
    "① ${LABELS[0]}: 근거 1~2문장",
    "② ${LABELS[1]}: 근거 1~2문장",
    "③ ${LABELS[2]}: 근거 1~2문장",
    "④ ${LABELS[3]}: 근거 1~2문장",
    "⑤ ${LABELS[4]}: 근거 1~2문장"
  ]
}`;

    const chatRes = await fetch('https://api.upstage.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTAGE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'solar-pro2',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    });
    if (!chatRes.ok) {
      const t = await chatRes.text();
      res.status(502).json({ error: `AI 평가 실패 (${chatRes.status})`, detail: t.slice(0, 300) });
      return;
    }
    const chat = await chatRes.json();
    const raw = (chat.choices && chat.choices[0] && chat.choices[0].message.content) || '';

    // JSON만 추출 (코드펜스·앞뒤 잡담 제거)
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('AI 응답에서 JSON을 찾지 못함');
    const result = JSON.parse(raw.slice(start, end + 1));

    if (!Array.isArray(result.scores) || result.scores.length !== 5) {
      throw new Error('AI 응답의 점수 형식이 올바르지 않음');
    }
    result.scores = result.scores.map((s) => Math.max(0, Math.min(10, Math.round(Number(s) || 0))));
    result.pages = (parsed.usage && parsed.usage.pages) || null;

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: '분석 중 오류가 발생했습니다.', detail: String(e.message).slice(0, 300) });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};
