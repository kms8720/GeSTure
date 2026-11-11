// GitHub Pages 입구 등록 전용. 앱·모델·터널을 실행하지 않는다.
import { checkAuth, initializePages } from './exhibition/pages.mjs';
try {
  await checkAuth();
  console.log(`고정 입구 등록 완료: ${await initializePages()}`);
  console.log('GitHub Pages 배포가 끝나면 대기 화면이 표시됩니다.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
