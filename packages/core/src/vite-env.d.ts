/// <reference types="vite/client" />

// Inline worker import (bundled into a base64 blob, self-contained)
declare module '*?worker&inline' {
  const c: new () => Worker;
  export default c;
}

// Non-inline worker import (URL-based)
declare module '*?worker' {
  const c: new () => Worker;
  export default c;
}
