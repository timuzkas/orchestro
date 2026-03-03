const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const API_USER = process.env.NEXT_PUBLIC_API_USER;
const API_PASS = process.env.NEXT_PUBLIC_API_PASS;

const getAuthHeader = () => {
  if (API_USER && API_PASS) {
    return {
      Authorization: `Basic ${btoa(`${API_USER}:${API_PASS}`)}`,
    };
  }
  return {};
};

export const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
  const url = endpoint.startsWith("http") ? endpoint : `${API_URL}${endpoint}`;
  const headers = {
    ...getAuthHeader(),
    ...options.headers,
  };

  return fetch(url, {
    ...options,
    headers,
  });
};

export const getWsUrl = (path: string = "/ws") => {
  let wsUrl = API_URL.replace(/^http/, "ws");
  
  if (API_USER && API_PASS) {
    const url = new URL(wsUrl);
    url.username = API_USER;
    url.password = API_PASS;
    wsUrl = url.toString();
  }
  
  return `${wsUrl}${path}`;
};

export { API_URL };
