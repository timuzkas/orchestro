const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const API_USER = process.env.NEXT_PUBLIC_API_USER;
const API_PASS = process.env.NEXT_PUBLIC_API_PASS;

const getAuthHeader = (): Record<string, string> => {
  if (API_USER && API_PASS) {
    return {
      Authorization: `Basic ${btoa(`${API_USER}:${API_PASS}`)}`,
    };
  }
  return {};
};

export const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
  const url = endpoint.startsWith("http") ? endpoint : `${API_URL}${endpoint}`;
  
  const headers = new Headers(options.headers);
  const auth = getAuthHeader();
  for (const [key, value] of Object.entries(auth)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return fetch(url, {
    ...options,
    headers,
  });
};

export const getWsUrl = (path: string = "/ws") => {
  let wsUrl = API_URL.replace(/^http/, "ws").replace(/\/$/, "");
  
  if (API_USER && API_PASS) {
    try {
      const url = new URL(wsUrl);
      url.username = API_USER;
      url.password = API_PASS;
      wsUrl = url.toString().replace(/\/$/, "");
    } catch (e) {
      console.error("Invalid API_URL for WebSocket construction:", e);
    }
  }
  
  return `${wsUrl}${path}`;
};

export { API_URL };
