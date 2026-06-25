// Exchanges a Strava authorization code (or refresh token) for an access token.
// Keeps STRAVA_CLIENT_SECRET server-side — it is never exposed to the browser.

const CLIENT_ID = "260923";
const TOKEN_URL = "https://www.strava.com/oauth/token";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const secret = process.env.STRAVA_CLIENT_SECRET;
  if (!secret) {
    return json(500, { error: "Server is missing STRAVA_CLIENT_SECRET" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const params = {
    client_id: CLIENT_ID,
    client_secret: secret,
  };

  if (body.code) {
    params.grant_type = "authorization_code";
    params.code = body.code;
  } else if (body.refresh_token) {
    params.grant_type = "refresh_token";
    params.refresh_token = body.refresh_token;
  } else {
    return json(400, { error: "Missing code or refresh_token" });
  }

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();

    if (!res.ok) {
      return json(res.status, { error: data.message || "Strava token error", details: data });
    }

    // Return only what the client needs.
    return json(200, {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      athlete: data.athlete || null,
    });
  } catch (err) {
    return json(502, { error: "Failed to reach Strava", details: String(err) });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}
