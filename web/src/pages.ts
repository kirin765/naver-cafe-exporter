const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; color: #1f2933; background: #f7f8fa; line-height: 1.6; }
header { background: #03c75a; color: #fff; padding: 16px 24px; }
header a { color: #fff; text-decoration: none; font-weight: 700; font-size: 18px; }
nav { margin-top: 8px; display: flex; gap: 16px; flex-wrap: wrap; font-size: 14px; }
nav a { color: #eafff2; font-weight: 400; }
main { max-width: 720px; margin: 32px auto; padding: 0 20px 64px; }
.card { background: #fff; border: 1px solid #e4e7eb; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
h1 { font-size: 24px; margin: 0 0 12px; }
h2 { font-size: 18px; margin: 24px 0 8px; }
label { display: block; font-weight: 600; margin-bottom: 6px; }
input[type=email] { width: 100%; padding: 10px 12px; border: 1px solid #cbd2d9; border-radius: 8px; font-size: 15px; }
button { background: #03c75a; color: #fff; border: 0; border-radius: 8px; padding: 10px 18px; font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 12px; }
button.secondary { background: #fff; color: #1f2933; border: 1px solid #cbd2d9; }
a.button { display: inline-block; background: #03c75a; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 700; margin-top: 12px; }
.muted { color: #616e7c; font-size: 14px; }
.badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 13px; font-weight: 700; }
.badge.paid { background: #d3f9d8; color: #2b8a3e; }
.badge.free { background: #e9ecef; color: #495057; }
.notice { background: #fff4e6; border: 1px solid #ffd8a8; border-radius: 8px; padding: 12px 16px; font-size: 14px; }
.price { font-size: 32px; font-weight: 800; }
footer { text-align: center; color: #9aa5b1; font-size: 13px; padding: 24px; }
ul { padding-left: 20px; }
`;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · 네이버 카페 엑셀 내보내기</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <a href="/">네이버 카페 엑셀 내보내기</a>
  <nav>
    <a href="/pricing">요금</a>
    <a href="/account">내 계정</a>
    <a href="/refund">환불 정책</a>
    <a href="/privacy">개인정보</a>
    <a href="/terms">이용약관</a>
  </nav>
</header>
<main>${body}</main>
<footer>© 2026 네이버 카페 엑셀 내보내기 · naver-cafe-exporter.onnurimun.com · 문의: support@onnurimun.com</footer>
</body>
</html>`;
}

export function homePage(): string {
  return layout(
    "홈",
    `<div class="card">
      <h1>네이버 카페 데이터 → 엑셀</h1>
      <p>접근 권한이 있는 네이버 카페의 게시글, 댓글, 작성자 정보를 엑셀(.xlsx)로 내보냅니다.</p>
      <p class="muted">수집은 사용자의 브라우저에서 실행되며, 수집한 카페 데이터는 서버로 전송되지 않습니다.</p>
      <a class="button" href="/pricing">요금 보기</a>
    </div>
    <div class="card">
      <h2>제품 계정</h2>
      <p class="muted">제품 계정은 네이버 로그인과 별개입니다. 결제 확인과 확장 프로그램 연결에만 사용됩니다.</p>
      <a class="button secondary" href="/login">로그인</a>
    </div>`
  );
}

export function loginPage(opts: { error?: string | null; next?: string | null; sent?: boolean } = {}): string {
  const nextValue = escapeHtml(opts.next ?? "/account");
  const errorBlock = opts.error ? `<p class="notice">${escapeHtml(opts.error)}</p>` : "";
  const sentBlock = opts.sent
    ? `<p class="notice">입력한 이메일로 로그인 링크를 보냈습니다. 메일함을 확인해 주세요.</p>`
    : "";
  return layout(
    "로그인",
    `<div class="card">
      <h1>로그인</h1>
      <p class="muted">이메일 주소로 일회용 로그인 링크를 보내드립니다. 비밀번호는 사용하지 않습니다.</p>
      ${errorBlock}
      ${sentBlock}
      <form method="post" action="/api/auth/magic-link">
        <input type="hidden" name="next" value="${nextValue}" />
        <label for="email">이메일</label>
        <input id="email" name="email" type="email" required placeholder="you@example.com" />
        <button type="submit">로그인 링크 받기</button>
      </form>
    </div>`
  );
}

export function extensionConnectPage(opts: {
  requestId: string;
  email?: string | null;
  error?: string | null;
  alreadyApproved?: boolean;
}): string {
  const errorBlock = opts.error ? `<p class="notice">${escapeHtml(opts.error)}</p>` : "";
  const approvedBlock = opts.alreadyApproved
    ? `<p class="notice">이미 승인되었습니다. 확장 프로그램으로 돌아가 연결을 완료하세요.</p>`
    : `<button id="approve">확장 프로그램 연결 승인</button>
       <p class="muted" id="status"></p>
       <script>
         const button = document.getElementById('approve');
         const status = document.getElementById('status');
         button.addEventListener('click', async () => {
           button.disabled = true;
           status.textContent = '승인 중...';
           try {
             const res = await fetch('/api/extension/link/approve', {
               method: 'POST',
               headers: { 'content-type': 'application/json' },
               body: JSON.stringify({ requestId: ${JSON.stringify(opts.requestId)} })
             });
             if (res.ok) {
               status.textContent = '승인되었습니다. 확장 프로그램으로 돌아가 주세요.';
             } else {
               const data = await res.json().catch(() => ({}));
               status.textContent = '승인 실패: ' + (data?.error?.message || res.status);
               button.disabled = false;
             }
           } catch (e) {
             status.textContent = '네트워크 오류가 발생했습니다.';
             button.disabled = false;
           }
         });
       </script>`;
  return layout(
    "확장 프로그램 연결",
    `<div class="card">
      <h1>확장 프로그램 연결 승인</h1>
      ${errorBlock}
      <p>로그인 계정: <strong>${escapeHtml(opts.email ?? "")}</strong></p>
      <p class="muted">아래 버튼을 누르면 이 브라우저의 확장 프로그램이 제품 계정에 연결됩니다. 요청 ID: <code>${escapeHtml(opts.requestId)}</code></p>
      ${approvedBlock}
    </div>`
  );
}

export function accountPage(opts: {
  email: string;
  active: boolean;
  status: string;
  paidUntil: string | null;
  graceUntil: string | null;
  revoked: boolean;
  revokeReason: string | null;
  cancelAtPeriodEnd: boolean;
  portalAvailable: boolean;
  checkoutSuccess?: boolean;
}): string {
  const badge = opts.active
    ? `<span class="badge paid">이용 중</span>`
    : `<span class="badge free">무료(미리보기)</span>`;
  const successBlock = opts.checkoutSuccess
    ? `<p class="notice">결제 확인 중입니다. 웹훅으로 결제가 확인되면 이용 권한이 활성화됩니다.</p>`
    : "";
  const revokeBlock = opts.revoked
    ? `<p class="notice">환불/지불거절로 이 구독의 이용 권한이 회수되었습니다${opts.revokeReason ? ` (사유: ${escapeHtml(opts.revokeReason)})` : ""}. 다시 이용하려면 새로 결제해 주세요.</p>`
    : "";
  const cancelBlock = opts.cancelAtPeriodEnd
    ? `<p class="muted">다음 결제가 해지 예약되었습니다. 현재 결제 기간이 끝날 때까지 이용할 수 있습니다.</p>`
    : "";
  const graceBlock = opts.graceUntil
    ? `<p class="muted">결제 실패로 유예 기간이 적용 중입니다. 유예 종료: ${escapeHtml(opts.graceUntil)}</p>`
    : "";

  return layout(
    "내 계정",
    `<div class="card">
      <h1>내 계정</h1>
      ${successBlock}
      ${revokeBlock}
      <p>${badge} <span class="muted">계정: ${escapeHtml(opts.email)}</span></p>
      <p class="muted">구독 상태: ${escapeHtml(opts.status)}${opts.paidUntil ? ` · 결제 기간 만료: ${escapeHtml(opts.paidUntil)}` : ""}</p>
      ${graceBlock}
      ${cancelBlock}
      <button id="portal" class="secondary" ${opts.portalAvailable ? "" : "disabled"}>결제 관리 / 구독 해지</button>
      <p class="muted" id="portal-status"></p>
      <script>
        const portal = document.getElementById('portal');
        const portalStatus = document.getElementById('portal-status');
        portal.addEventListener('click', async () => {
          portal.disabled = true;
          portalStatus.textContent = '이동 중...';
          try {
            const res = await fetch('/api/billing/portal', { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.url) { window.location.href = data.url; return; }
            portalStatus.textContent = '실패: ' + (data?.error?.message || res.status);
          } catch (e) {
            portalStatus.textContent = '네트워크 오류가 발생했습니다.';
          }
          portal.disabled = false;
        });
      </script>
    </div>
    <div class="card">
      <h2>구독 해지 안내</h2>
      <p class="muted">구독 해지는 언제든지 가능하며, 해지 시 다음 결제부터 청구되지 않습니다. 이미 결제된 현재 기간은 만료일까지 이용할 수 있습니다. 환불은 <a href="/refund">환불 정책</a>을 따릅니다.</p>
      <a class="button" href="/pricing">요금제 보기</a>
    </div>`
  );
}

export function pricingPage(): string {
  return layout(
    "요금",
    `<div class="card">
      <h1>요금제</h1>
      <p class="price">₩4,900 <span class="muted" style="font-size:16px">/ 월</span></p>
      <p>매월 자동 결제, 언제든 다음 결제 해지</p>
      <ul>
        <li>모든 지원 내보내기 모드</li>
        <li>필터, 이어하기, 반복 내보내기</li>
        <li>세금 포함 총액 ₩4,900</li>
      </ul>
      <button id="checkout">구독 시작</button>
      <p class="muted" id="checkout-status"></p>
      <script>
        const checkout = document.getElementById('checkout');
        const status = document.getElementById('checkout-status');
        checkout.addEventListener('click', async () => {
          checkout.disabled = true;
          status.textContent = '결제 페이지로 이동 중...';
          try {
            const res = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            const data = await res.json();
            if (res.status === 401) { window.location.href = '/login?next=/pricing'; return; }
            if (res.ok && data.url) { window.location.href = data.url; return; }
            status.textContent = '실패: ' + (data?.error?.message || res.status);
          } catch (e) {
            status.textContent = '네트워크 오류가 발생했습니다.';
          }
          checkout.disabled = false;
        });
      </script>
    </div>`
  );
}

export function privacyPage(): string {
  return layout(
    "개인정보 처리방침",
    `<div class="card">
      <h1>개인정보 처리방침</h1>
      <p><strong>수집한 카페 데이터는 백엔드로 전송되지 않습니다.</strong> 게시글 본문, 댓글, 회원 ID, 작성자 식별자, 네이버 쿠키, 생성된 엑셀 파일은 모두 사용자의 컴퓨터(브라우저)에만 저장되며 제품 서버로 전송되거나 서버에 저장되지 않습니다.</p>
      <h2>서버가 저장하는 정보</h2>
      <ul>
        <li>제품 계정 이메일과 로그인 세션</li>
        <li>확장 프로그램 연결 토큰(철회 가능)</li>
        <li>Paddle 고객/구독/결제 기간/환불(조정) 매핑</li>
        <li>진단용 어댑터 버전, 오류 코드, 개수·시간 정보(원문 텍스트 제외)</li>
      </ul>
      <h2>서버가 저장하지 않는 정보</h2>
      <ul>
        <li>수집된 카페 게시글·댓글·회원·작성자 데이터</li>
        <li>네이버 로그인 쿠키 또는 자격 증명</li>
        <li>생성된 엑셀 파일</li>
      </ul>
      <p class="muted">문의: support@example.com</p>
    </div>`
  );
}

export function termsPage(): string {
  return layout(
    "이용약관",
    `<div class="card">
      <h1>이용약관</h1>
      <p>본 제품은 사용자가 접근 권한을 가진 네이버 카페 콘텐츠를 엑셀로 내보내는 도구입니다.</p>
      <ul>
        <li>로그인/CAPTCHA 우회, 숨김·삭제된 기록 수집, 대량 연락처 재판매를 지원하지 않습니다.</li>
        <li>결제 구독은 제품 기능만 부여하며, 카페 가입·등업·비공개 게시판 접근 권한을 부여하지 않습니다.</li>
        <li>수집은 사용자의 브라우저에서 실행되며, 사용자가 적법한 권한을 보유해야 합니다.</li>
      </ul>
      <p class="muted">문의: support@example.com</p>
    </div>`
  );
}

export function refundPage(): string {
  return layout(
    "환불 정책",
    `<div class="card">
      <h1>환불 정책</h1>
      <p>결제는 Paddle을 통해 처리됩니다. 환불은 다음 원칙을 따릅니다.</p>
      <h2>전액 환불 (현재 결제 기간)</h2>
      <p>현재 이용 기간을 완전히 커버하는 확정된 전액 환불 또는 지불거절(chargeback)은 해당 기간의 이용 권한을 회수하고, 향후 갱신을 중지하기 위해 영향을 받은 구독을 해지합니다. 회수는 되돌릴 수 없으며, 재이용은 새 결제가 필요합니다.</p>
      <h2>부분 환불</h2>
      <p>부분 환불은 이용 권한을 자동으로 회수하지 않습니다.</p>
      <h2>과거 기간 환불</h2>
      <p>이미 지난 결제 기간에 대한 환불은 현재 결제 기간의 이용 권한을 회수하지 않습니다.</p>
      <h2>승인 대기/거절된 환불</h2>
      <p>승인 대기 중이거나 거절된 환불은 이용 권한에 영향을 주지 않습니다. 환불 승인 대기가 별도로 요청한 구독 해지를 지연시키지 않습니다.</p>
      <h2>지불거절 철회(반전)</h2>
      <p>환불/지불거절이 철회(반전)되면 회수 상태를 다시 평가하여 해제할 수 있습니다.</p>
      <p class="muted">문의: support@example.com</p>
    </div>`
  );
}

export function notFoundPage(): string {
  return layout("페이지 없음", `<div class="card"><h1>페이지를 찾을 수 없습니다</h1><a class="button" href="/">홈으로</a></div>`);
}

export function errorPage(message: string): string {
  return layout("오류", `<div class="card"><h1>오류</h1><p class="notice">${escapeHtml(message)}</p></div>`);
}
