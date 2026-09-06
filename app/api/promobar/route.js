// ✅ FULL FILE: app/api/promobar/route.js

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * TDLS PromoBar API
 * =============================================================================
 *
 * PURPOSE
 * -----------------------------------------------------------------------------
 * Supply the storefront PromoBar with REAL promotional messages from Strapi.
 *
 * Supported Strapi shapes:
 *
 * Strapi v4:
 * {
 *   data: {
 *     id: 1,
 *     attributes: {
 *       message: "...",
 *       enabled: true
 *     }
 *   }
 * }
 *
 * Strapi flattened / newer shape:
 * {
 *   data: {
 *     id: 1,
 *     documentId: "...",
 *     message: "...",
 *     enabled: true
 *   }
 * }
 *
 * Collection:
 * {
 *   data: [
 *     { id: 1, attributes: {...} },
 *     { id: 2, message: "...", enabled: true }
 *   ]
 * }
 *
 * Also supports:
 * - Promo message directly inside promobar-config
 * - Promo messages as relation/component inside promobar-config
 * - Standalone promobar-messages collection
 * - Legacy /api/promobars collection
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 * We DO NOT put filters[enabled] in the Strapi request.
 *
 * Why:
 * If the content type does not contain an exact field called `enabled`,
 * Strapi can reject the whole request.
 *
 * Instead:
 * - Fetch the records
 * - Normalize them
 * - Apply enabled/date filtering locally
 *
 * OUTPUT CONTRACT
 * -----------------------------------------------------------------------------
 * {
 *   enabled: true,
 *   source: "strapi-messages" | "strapi-config" | "strapi-embedded" | "fallback",
 *   bg: "#0C2340",
 *   fg: "#FFFDF8",
 *   closable: true,
 *   speed: 52,
 *   gapMs: 650,
 *   dwellMs: 5200,
 *   animation: "fade",
 *   startsAt: null,
 *   endsAt: null,
 *   dismissId: "...",
 *   messages: [
 *     {
 *       id: "...",
 *       message: "...",
 *       link: null,
 *       animation: undefined
 *     }
 *   ]
 * }
 */

/* =============================================================================
 * STRAPI ENV
 * ========================================================================== */

const RAW_STRAPI_ORIGIN =
  process.env.STRAPI_API_ORIGIN ||
  process.env.STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.NEXT_PUBLIC_STRAPI_API_ORIGIN ||
  "http://127.0.0.1:1337";

const STRAPI_TOKEN =
  process.env.STRAPI_API_TOKEN ||
  process.env.STRAPI_GRAPHQL_TOKEN ||
  process.env.STRAPI_TOKEN ||
  "";

/**
 * Normalize to:
 *
 * https://cms.example.com
 *
 * NOT:
 *
 * https://cms.example.com/
 * https://cms.example.com/api
 *
 * Otherwise this route could accidentally request:
 *
 * /api/api/promobar-config
 */
function normalizeOrigin(raw) {
  let origin = String(raw || "").trim();

  if (!origin) return "";

  if (!/^https?:\/\//i.test(origin)) {
    origin = `${
      process.env.NODE_ENV === "production"
        ? "https"
        : "http"
    }://${origin}`;
  }

  origin = origin.replace(/\/+$/, "");

  /*
   * Some environment variables are configured as:
   *
   * https://cms.example.com/api
   *
   * This API route appends /api itself, so remove the final /api.
   */
  origin = origin.replace(/\/api$/i, "");

  return origin;
}

const STRAPI_ORIGIN = normalizeOrigin(
  RAW_STRAPI_ORIGIN
);

const HEADERS = {
  Accept: "application/json",

  ...(STRAPI_TOKEN
    ? {
        Authorization: `Bearer ${STRAPI_TOKEN}`,
      }
    : {}),
};

/* =============================================================================
 * ENDPOINTS
 * ========================================================================== */

/**
 * Preferred config single type.
 */
const CONFIG_ENDPOINTS = [
  "/api/promobar-config?populate=*",

  /*
   * Legacy alternative.
   */
  "/api/promobar?populate=*",
];

/**
 * IMPORTANT:
 *
 * Do NOT add:
 *
 * &filters[enabled][$eq]=true
 *
 * because the API should remain compatible even if your Strapi model uses:
 *
 * active
 * isEnabled
 * is_enabled
 *
 * or contains no enable field at all.
 */
const MESSAGE_ENDPOINTS = [
  "/api/promobar-messages?pagination[pageSize]=100&sort=order:asc&populate=*",

  /*
   * If order does not exist, the request above could fail.
   * This version has no sort.
   */
  "/api/promobar-messages?pagination[pageSize]=100&populate=*",

  /*
   * Legacy collection.
   */
  "/api/promobars?pagination[pageSize]=100&populate=*",
];

/* =============================================================================
 * SAFE FALLBACK
 * ========================================================================== */

/**
 * This is used ONLY when Strapi genuinely provides no usable promotional
 * message.
 *
 * It makes no discount/price promise.
 */
const FALLBACK_MESSAGE =
  process.env.PROMOBAR_FALLBACK_MESSAGE ||
  "Welcome to The DNA Lab Store — discover our latest collections.";

const FALLBACK_LINK =
  process.env.PROMOBAR_FALLBACK_LINK ||
  null;

const FALLBACK_VERSION =
  process.env.PROMOBAR_FALLBACK_VERSION ||
  "tdls-promobar-fallback-v4";

/* =============================================================================
 * GENERIC HELPERS
 * ========================================================================== */

function toCleanString(
  value,
  fallback = ""
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const stringValue =
    String(value).trim();

  return stringValue || fallback;
}

function toFiniteNumber(
  value,
  fallback
) {
  const numberValue =
    Number(value);

  return Number.isFinite(
    numberValue
  )
    ? numberValue
    : fallback;
}

function clamp(
  value,
  min,
  max
) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

function toBoolean(
  value,
  fallback = false
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  if (
    typeof value === "boolean"
  ) {
    return value;
  }

  if (
    typeof value === "number"
  ) {
    return value !== 0;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    [
      "true",
      "1",
      "yes",
      "y",
      "on",
      "enabled",
      "active",
    ].includes(normalized)
  ) {
    return true;
  }

  if (
    [
      "false",
      "0",
      "no",
      "n",
      "off",
      "disabled",
      "inactive",
    ].includes(normalized)
  ) {
    return false;
  }

  return fallback;
}

function pick(
  object,
  keys,
  fallback = undefined
) {
  if (
    !object ||
    typeof object !== "object"
  ) {
    return fallback;
  }

  for (const key of keys) {
    const value =
      object[key];

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return fallback;
}

/* =============================================================================
 * STRAPI ENTITY NORMALIZATION
 * ========================================================================== */

/**
 * Converts:
 *
 * {
 *   id: 1,
 *   attributes: {
 *     message: "Hello"
 *   }
 * }
 *
 * into:
 *
 * {
 *   id: 1,
 *   message: "Hello"
 * }
 *
 * Flattened records are left intact.
 */
function flattenEntity(entity) {
  if (
    !entity ||
    typeof entity !== "object"
  ) {
    return null;
  }

  if (
    entity.attributes &&
    typeof entity.attributes ===
      "object"
  ) {
    return {
      id:
        entity.id ??
        entity.attributes.id ??
        null,

      documentId:
        entity.documentId ??
        entity.attributes
          .documentId ??
        null,

      ...entity.attributes,
    };
  }

  return {
    ...entity,
  };
}

function unwrapRelation(value) {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return value;
  }

  /*
   * Strapi relation:
   *
   * {
   *   data: [...]
   * }
   */
  if (
    Object.prototype.hasOwnProperty.call(
      value,
      "data"
    )
  ) {
    return value.data;
  }

  return value;
}

function extractSingle(raw) {
  if (!raw) return null;

  if (Array.isArray(raw)) {
    return flattenEntity(
      raw[0]
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      raw,
      "data"
    )
  ) {
    if (
      Array.isArray(raw.data)
    ) {
      return flattenEntity(
        raw.data[0]
      );
    }

    return flattenEntity(
      raw.data
    );
  }

  return flattenEntity(raw);
}

function extractCollection(raw) {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw
      .map(flattenEntity)
      .filter(Boolean);
  }

  if (
    Array.isArray(raw.data)
  ) {
    return raw.data
      .map(flattenEntity)
      .filter(Boolean);
  }

  /*
   * A single item is also accepted.
   */
  if (
    raw.data &&
    typeof raw.data === "object"
  ) {
    const entity =
      flattenEntity(raw.data);

    return entity
      ? [entity]
      : [];
  }

  const entity =
    flattenEntity(raw);

  return entity
    ? [entity]
    : [];
}

/* =============================================================================
 * DATES
 * ========================================================================== */

function toDate(value) {
  if (!value) return null;

  const date = new Date(
    value
  );

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}

function isWithinWindow(
  startsAt,
  endsAt,
  now = new Date()
) {
  const start =
    toDate(startsAt);

  const end =
    toDate(endsAt);

  if (
    start &&
    now < start
  ) {
    return false;
  }

  if (
    end &&
    now > end
  ) {
    return false;
  }

  return true;
}

/* =============================================================================
 * LINK NORMALIZATION
 * ========================================================================== */

function normalizeLink(
  value
) {
  if (!value) return null;

  if (
    typeof value === "string"
  ) {
    return (
      value.trim() ||
      null
    );
  }

  if (
    typeof value === "object"
  ) {
    const flattened =
      flattenEntity(
        unwrapRelation(value)
      );

    if (
      Array.isArray(
        flattened
      )
    ) {
      return null;
    }

    return (
      toCleanString(
        pick(
          flattened || value,
          [
            "url",
            "href",
            "link",
            "linkUrl",
            "link_url",
          ],
          ""
        ),
        ""
      ) || null
    );
  }

  return null;
}

/* =============================================================================
 * CONFIG NORMALIZER
 * ========================================================================== */

function normalizeConfig(raw) {
  const entity =
    extractSingle(raw);

  if (!entity) {
    return null;
  }

  const enabledValue =
    pick(
      entity,
      [
        "enabled",
        "is_enabled",
        "isEnabled",
        "active",
        "is_active",
        "isActive",
        "published",
      ],
      true
    );

  return {
    id:
      entity.id ??
      null,

    documentId:
      entity.documentId ??
      null,

    updatedAt:
      pick(
        entity,
        [
          "updatedAt",
          "updated_at",
        ],
        null
      ) || null,

    enabled:
      toBoolean(
        enabledValue,
        true
      ),

    bg:
      toCleanString(
        pick(
          entity,
          [
            "background_color",
            "backgroundColor",
            "bg_color",
            "bgColor",
            "background",
            "bg",
          ],
          "#0C2340"
        ),
        "#0C2340"
      ),

    fg:
      toCleanString(
        pick(
          entity,
          [
            "text_color",
            "textColor",
            "foreground_color",
            "foregroundColor",
            "fg_color",
            "fgColor",
            "color",
            "fg",
          ],
          "#FFFDF8"
        ),
        "#FFFDF8"
      ),

    /*
     * Requirement:
     * customer can dismiss PromoBar.
     */
    closable: true,

    speed:
      clamp(
        toFiniteNumber(
          pick(
            entity,
            [
              "speed_px_per_sec",
              "speedPxPerSec",
              "speed",
              "px_per_sec",
            ],
            52
          ),
          52
        ),
        15,
        300
      ),

    gapMs:
      clamp(
        toFiniteNumber(
          pick(
            entity,
            [
              "gap_ms",
              "gapMs",
              "gap",
              "pause_ms",
              "pauseMs",
            ],
            650
          ),
          650
        ),
        0,
        30000
      ),

    dwellMs:
      clamp(
        toFiniteNumber(
          pick(
            entity,
            [
              "dwell_ms",
              "dwellMs",
              "dwell",
              "message_dwell_ms",
              "messageDwellMs",
            ],
            5200
          ),
          5200
        ),
        0,
        60000
      ),

    animation:
      toCleanString(
        pick(
          entity,
          [
            "animation",
            "animation_style",
            "animationStyle",
            "style",
          ],
          "fade"
        ),
        "fade"
      ).toLowerCase(),

    startsAt:
      pick(
        entity,
        [
          "starts_at",
          "startsAt",
          "start_at",
          "startAt",
          "start_datetime",
          "startDatetime",
          "start_date",
          "startDate",
        ],
        null
      ) || null,

    endsAt:
      pick(
        entity,
        [
          "ends_at",
          "endsAt",
          "end_at",
          "endAt",
          "end_datetime",
          "endDatetime",
          "end_date",
          "endDate",
        ],
        null
      ) || null,

    dismissId:
      pick(
        entity,
        [
          "dismiss_id",
          "dismissId",
          "version",
          "campaign_id",
          "campaignId",
        ],
        null
      ) || null,

    /*
     * A message may be stored DIRECTLY on the config single type.
     */
    singleMessage:
      toCleanString(
        pick(
          entity,
          [
            "message",

            /*
             * Additional reasonable CMS field aliases.
             */
            "promotional_message",
            "promotionalMessage",

            "promo_message",
            "promoMessage",

            "announcement",
            "announcement_text",
            "announcementText",

            "message_text",
            "messageText",

            "content",
            "text",

            /*
             * Keep title last so a dedicated message wins.
             */
            "title",
          ],
          ""
        ),
        ""
      ),

    singleLink:
      normalizeLink(
        pick(
          entity,
          [
            "link",
            "url",
            "href",
            "linkUrl",
            "link_url",
            "cta_link",
            "ctaLink",
          ],
          null
        )
      ),

    /*
     * Keep original normalized entity so we can inspect embedded
     * components/relations afterward.
     */
    rawEntity: entity,
  };
}

/* =============================================================================
 * MESSAGE NORMALIZER
 * ========================================================================== */

function normalizeMessageEntity(
  rawEntity,
  index = 0
) {
  const entity =
    flattenEntity(
      rawEntity
    );

  if (!entity) {
    return null;
  }

  const enabled =
    toBoolean(
      pick(
        entity,
        [
          "enabled",
          "is_enabled",
          "isEnabled",
          "active",
          "is_active",
          "isActive",
          "published",
        ],
        true
      ),
      true
    );

  if (!enabled) {
    return null;
  }

  const message =
    toCleanString(
      pick(
        entity,
        [
          "message",

          /*
           * Support more explicit names commonly used in a CMS.
           */
          "promotional_message",
          "promotionalMessage",

          "promo_message",
          "promoMessage",

          "announcement",
          "announcement_text",
          "announcementText",

          "message_text",
          "messageText",

          "content",

          "text",

          "title",

          "label",

          "description",
        ],
        ""
      ),
      ""
    );

  if (!message) {
    return null;
  }

  const startsAt =
    pick(
      entity,
      [
        "starts_at",
        "startsAt",
        "start_at",
        "startAt",
        "start_datetime",
        "startDatetime",
        "start_date",
        "startDate",
      ],
      null
    ) || null;

  const endsAt =
    pick(
      entity,
      [
        "ends_at",
        "endsAt",
        "end_at",
        "endAt",
        "end_datetime",
        "endDatetime",
        "end_date",
        "endDate",
      ],
      null
    ) || null;

  if (
    !isWithinWindow(
      startsAt,
      endsAt
    )
  ) {
    return null;
  }

  const animation =
    toCleanString(
      pick(
        entity,
        [
          "animation",
          "animation_style",
          "animationStyle",
          "style",
          "anim",
        ],
        ""
      ),
      ""
    ).toLowerCase();

  const id =
    toCleanString(
      entity.id ??
        entity.documentId ??
        `message-${index}`,
      `message-${index}`
    ).slice(0, 128);

  return {
    id,

    message,

    link:
      normalizeLink(
        pick(
          entity,
          [
            "link",
            "url",
            "href",
            "linkUrl",
            "link_url",
            "cta_link",
            "ctaLink",
          ],
          null
        )
      ),

    animation:
      animation ||
      undefined,
  };
}

function normalizeMessageCollection(
  raw
) {
  return extractCollection(
    raw
  )
    .map(
      (
        item,
        index
      ) =>
        normalizeMessageEntity(
          item,
          index
        )
    )
    .filter(Boolean);
}

/* =============================================================================
 * EMBEDDED / RELATIONAL MESSAGES
 * ========================================================================== */

/**
 * populate=* can place the messages directly inside the config.
 *
 * Example:
 *
 * {
 *   data: {
 *     messages: {
 *       data: [...]
 *     }
 *   }
 * }
 *
 * or:
 *
 * {
 *   data: {
 *     promotional_messages: [...]
 *   }
 * }
 */
const EMBEDDED_MESSAGE_KEYS = [
  "messages",

  "promobar_messages",
  "promobarMessages",

  "promo_messages",
  "promoMessages",

  "promotional_messages",
  "promotionalMessages",

  "announcements",

  "promotions",

  "items",
];

function extractEmbeddedMessages(
  config
) {
  const entity =
    config?.rawEntity;

  if (
    !entity ||
    typeof entity !== "object"
  ) {
    return [];
  }

  for (
    const key of EMBEDDED_MESSAGE_KEYS
  ) {
    const rawValue =
      entity[key];

    if (!rawValue) {
      continue;
    }

    const relation =
      unwrapRelation(
        rawValue
      );

    const array =
      Array.isArray(
        relation
      )
        ? relation
        : relation &&
            typeof relation ===
              "object"
          ? [relation]
          : [];

    const normalized =
      array
        .map(
          (
            item,
            index
          ) =>
            normalizeMessageEntity(
              item,
              index
            )
        )
        .filter(Boolean);

    if (
      normalized.length
    ) {
      return normalized;
    }
  }

  return [];
}

/* =============================================================================
 * NETWORK
 * ========================================================================== */

async function fetchStrapi(
  path
) {
  if (!STRAPI_ORIGIN) {
    return {
      ok: false,
      status: 0,
      path,
      json: null,
    };
  }

  try {
    const response =
      await fetch(
        `${STRAPI_ORIGIN}${path}`,
        {
          method: "GET",

          headers:
            HEADERS,

          cache:
            "no-store",
        }
      );

    let json = null;

    try {
      json =
        await response.json();
    } catch {
      json = null;
    }

    return {
      ok:
        response.ok,

      status:
        response.status,

      path,

      json,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      path,
      json: null,
    };
  }
}

async function firstSuccessful(
  paths
) {
  for (
    const path of paths
  ) {
    const result =
      await fetchStrapi(
        path
      );

    if (
      result.ok &&
      result.json
    ) {
      return result;
    }
  }

  return null;
}

/* =============================================================================
 * DISMISS ID
 * ========================================================================== */

function hashString(
  value
) {
  const stringValue =
    String(value || "");

  /*
   * Simple deterministic hash.
   */
  let hash = 2166136261;

  for (
    let i = 0;
    i <
    stringValue.length;
    i += 1
  ) {
    hash ^=
      stringValue.charCodeAt(
        i
      );

    hash =
      Math.imul(
        hash,
        16777619
      );
  }

  return (
    hash >>> 0
  ).toString(36);
}

function createDismissId(
  config,
  messages,
  source
) {
  if (
    config?.dismissId
  ) {
    return String(
      config.dismissId
    );
  }

  const seed =
    JSON.stringify({
      source,

      configId:
        config?.id ??
        null,

      documentId:
        config?.documentId ??
        null,

      updatedAt:
        config?.updatedAt ??
        null,

      startsAt:
        config?.startsAt ??
        null,

      endsAt:
        config?.endsAt ??
        null,

      messages:
        messages.map(
          (item) => ({
            id: item.id,

            message:
              item.message,

            link:
              item.link,
          })
        ),
    }).slice(
      0,
      16000
    );

  return `tdls-${hashString(
    seed
  )}`;
}

/* =============================================================================
 * RESPONSE
 * ========================================================================== */

function createJsonResponse(
  payload
) {
  return new Response(
    JSON.stringify(
      payload
    ),
    {
      status: 200,

      headers: {
        "content-type":
          "application/json; charset=utf-8",

        /*
         * New CMS promotions must become visible immediately.
         */
        "cache-control":
          "no-store, no-cache, must-revalidate, max-age=0",

        pragma:
          "no-cache",

        expires:
          "0",

        /*
         * Helpful when checking the request in DevTools.
         */
        "x-tdls-promobar-source":
          payload.source ||
          "unknown",
      },
    }
  );
}

function createEmptyResponse(
  reason = "disabled"
) {
  return new Response(
    null,
    {
      status: 204,

      headers: {
        "cache-control":
          "no-store, no-cache, must-revalidate, max-age=0",

        "x-tdls-promobar-source":
          reason,
      },
    }
  );
}

/* =============================================================================
 * DEFAULT CONFIG
 * ========================================================================== */

function defaultConfig() {
  return {
    id: null,

    documentId: null,

    updatedAt: null,

    enabled: true,

    bg: "#0C2340",

    fg: "#FFFDF8",

    closable: true,

    speed: 52,

    gapMs: 650,

    dwellMs: 5200,

    animation: "fade",

    startsAt: null,

    endsAt: null,

    dismissId: null,

    singleMessage: "",

    singleLink: null,

    rawEntity: null,
  };
}

/* =============================================================================
 * FINAL PAYLOAD
 * ========================================================================== */

function buildPayload({
  config,
  messages,
  source,
}) {
  const cfg =
    config ||
    defaultConfig();

  return {
    enabled: true,

    source,

    bg:
      cfg.bg ||
      "#0C2340",

    fg:
      cfg.fg ||
      "#FFFDF8",

    /*
     * Customer must be able to dismiss it.
     */
    closable: true,

    speed:
      cfg.speed ||
      52,

    gapMs:
      cfg.gapMs ??
      650,

    dwellMs:
      cfg.dwellMs ??
      5200,

    animation:
      cfg.animation ||
      "fade",

    startsAt:
      cfg.startsAt ||
      null,

    endsAt:
      cfg.endsAt ||
      null,

    dismissId:
      createDismissId(
        cfg,
        messages,
        source
      ),

    messages,
  };
}

/* =============================================================================
 * GET
 * ========================================================================== */

export async function GET() {
  /*
   * -----------------------------------------------------------------------
   * 1. CONFIG
   * -----------------------------------------------------------------------
   */

  const configResult =
    await firstSuccessful(
      CONFIG_ENDPOINTS
    );

  const config =
    configResult
      ? normalizeConfig(
          configResult.json
        )
      : null;

  /*
   * An existing config explicitly set to disabled must be respected.
   *
   * Missing config is NOT considered disabled.
   */
  if (
    config &&
    !config.enabled
  ) {
    return createEmptyResponse(
      "strapi-disabled"
    );
  }

  /*
   * Campaign start/end window.
   */
  if (
    config &&
    !isWithinWindow(
      config.startsAt,
      config.endsAt
    )
  ) {
    return createEmptyResponse(
      "outside-campaign-window"
    );
  }

  /*
   * -----------------------------------------------------------------------
   * 2. STANDALONE MESSAGE COLLECTION
   * -----------------------------------------------------------------------
   */

  const messageResult =
    await firstSuccessful(
      MESSAGE_ENDPOINTS
    );

  let messages =
    messageResult
      ? normalizeMessageCollection(
          messageResult.json
        )
      : [];

  /*
   * This is the preferred source when the CMS has a dedicated
   * promobar-messages collection.
   */
  if (
    messages.length
  ) {
    return createJsonResponse(
      buildPayload({
        config:
          config ||
          defaultConfig(),

        messages,

        source:
          "strapi-messages",
      })
    );
  }

  /*
   * -----------------------------------------------------------------------
   * 3. MESSAGES EMBEDDED/RELATED INSIDE CONFIG
   * -----------------------------------------------------------------------
   */

  if (config) {
    messages =
      extractEmbeddedMessages(
        config
      );

    if (
      messages.length
    ) {
      return createJsonResponse(
        buildPayload({
          config,

          messages,

          source:
            "strapi-embedded",
        })
      );
    }
  }

  /*
   * -----------------------------------------------------------------------
   * 4. MESSAGE DIRECTLY ON CONFIG
   * -----------------------------------------------------------------------
   */

  if (
    config?.singleMessage
  ) {
    messages = [
      {
        id:
          toCleanString(
            config.documentId ??
              config.id ??
              "config-message",
            "config-message"
          ),

        message:
          config.singleMessage,

        link:
          config.singleLink,

        animation:
          undefined,
      },
    ];

    return createJsonResponse(
      buildPayload({
        config,

        messages,

        source:
          "strapi-config",
      })
    );
  }

  /*
   * -----------------------------------------------------------------------
   * 5. SAFE FALLBACK
   * -----------------------------------------------------------------------
   *
   * If Strapi/config/messages are unavailable, keep the PromoBar architecture
   * working.
   *
   * This fallback should disappear automatically as soon as Strapi supplies
   * a real message.
   */

  const fallbackConfig =
    config ||
    defaultConfig();

  const fallbackMessages = [
    {
      id:
        FALLBACK_VERSION,

      message:
        FALLBACK_MESSAGE,

      link:
        FALLBACK_LINK,

      animation:
        "fade",
    },
  ];

  return createJsonResponse(
    buildPayload({
      config: {
        ...fallbackConfig,

        /*
         * Ensure fallback dismissal does not accidentally dismiss the later
         * real Strapi campaign.
         */
        dismissId:
          `${FALLBACK_VERSION}-${hashString(
            FALLBACK_MESSAGE
          )}`,
      },

      messages:
        fallbackMessages,

      source:
        "fallback",
    })
  );
}