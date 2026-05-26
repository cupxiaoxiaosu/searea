/**
 * @param {object} [options]
 * @param {(args: { status: number, body: unknown, success: boolean }) => unknown} [options.formatResponse]
 */
export function createResponseFormatter(options = {}) {
  const formatResponse = options.formatResponse;

  if (typeof formatResponse !== "function") {
    return {
      wrap(_status, body) {
        return body;
      },
      formatResponse: null,
      injectScript() {
        return "";
      },
    };
  }

  return {
    wrap(status, body) {
      const success = status >= 200 && status < 300;
      return formatResponse({ status, body, success });
    },
    formatResponse,
    injectScript() {
      return `<script>window.__searea_formatResponse=function(e){if(e&&"object"==typeof e&&!Array.isArray(e)&&"data"in e)return e.data;return e};</script>`;
    },
  };
}
