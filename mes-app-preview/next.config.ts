import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // 이 컴퓨터 IP로 접속하는 사내 다른 PC(예: 3001번 미리보기 서버 접속자)도 HMR 등
  // 개발용 리소스를 정상적으로 받을 수 있도록 — 없으면 페이지가 "불러오는 중"에서
  // 멈춘 것처럼 보인다(Next.js 16 dev 서버가 기본적으로 non-localhost 오리진을 차단).
  allowedDevOrigins: ["172.30.1.91"],
  experimental: {
    // proxy.ts(구 middleware.ts)가 있으면 Next.js가 요청 본문을 자동으로 복제·버퍼링
    // 하는데, 기본 한도가 10MB라 그보다 큰 엑셀 업로드(예: 제품등록 10.8MB, 69,413행)는
    // 본문이 중간에 잘려 route handler의 req.formData()가 "업로드할 파일이 없습니다"로
    // 실패한다(2026-09-04 실제 재현·확인 — node_modules/next/dist/docs/.../
    // proxyClientMaxBodySize.md). 이 앱이 다루는 원본 엑셀 중 가장 큰 것(일일작업현황
    // 등 100MB대)까지 넉넉히 커버하도록 200mb로 올린다.
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
