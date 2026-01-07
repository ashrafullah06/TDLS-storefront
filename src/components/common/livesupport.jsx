// /src/components/common/livesupport.jsx
import React, { useRef, useState } from "react";

// Real backend AI call
async function fetchAIReply(message, conversation) {
  const res = await fetch("/api/livesupport", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversation }),
  });
  if (!res.ok) {
    return {
      ai: false,
      text: "AI is unavailable at the moment. Please try again or request a human agent.",
      options: [],
    };
  }
  return await res.json();
}

export default function LiveSupport({ user }) {
  const [conversation, setConversation] = useState([
    {
      from: "ai",
      text: "👋 Hi! This is TDLC LiveSupport. How can I help you today?",
      ts: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const messagesEndRef = useRef();

  // Scroll to last message on update
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation, pending, escalated]);

  // Handle sending user message
  async function handleSend(message) {
    if (!message.trim()) return;
    setConversation((c) => [
      ...c,
      {
        from: "user",
        text: message,
        ts: new Date().toISOString(),
      },
    ]);
    setInput("");
    setPending(true);

    // API/AI call
    const reply = await fetchAIReply(message, conversation);
    setConversation((c) => [
      ...c,
      {
        from: reply.ai ? "ai" : "human",
        text: reply.text,
        ts: new Date().toISOString(),
        options: reply.options || [],
      },
    ]);
    setPending(false);
    if (!reply.ai) setEscalated(true);
  }

  // Handle escalation to human (could connect to live human chat backend)
  function handleHumanEscalation() {
    setConversation((c) => [
      ...c,
      {
        from: "human",
        text: "👩‍💼 This is a TDLC support agent. How can I assist you?",
        ts: new Date().toISOString(),
      },
    ]);
    setEscalated(true);
  }

  // Option button quick reply
  function handleOption(option) {
    handleSend(option.value);
  }

  // Render a single message bubble
  function MessageBubble({ msg }) {
    const isAI = msg.from === "ai";
    const isHuman = msg.from === "human";
    return (
      <div
        className={`flex ${isAI ? "justify-start" : isHuman ? "justify-start" : "justify-end"} mb-3`}
      >
        <div
          className={`max-w-[78%] rounded-2xl px-4 py-2 shadow ${
            isAI
              ? "bg-blue-50 text-blue-900"
              : isHuman
              ? "bg-amber-50 text-amber-900 border border-amber-200"
              : "bg-primary-700 text-white"
          }`}
          tabIndex={0}
        >
          <div className="text-sm md:text-base">{msg.text}</div>
          {Array.isArray(msg.options) && msg.options.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {msg.options.map((option, i) => (
                <button
                  key={i}
                  className="px-3 py-1 rounded-full text-xs bg-primary-50 border border-primary-100 text-primary-700 hover:bg-primary-100 font-semibold transition"
                  onClick={() => handleOption(option)}
                  tabIndex={0}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-[370px] max-w-full md:w-[370px] bg-white border border-primary-100 shadow-2xl rounded-2xl flex flex-col"
      style={{ minHeight: "410px", maxHeight: "65vh" }}
      aria-label="LiveSupport"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-primary-100 bg-primary-800 rounded-t-2xl">
        <div className="text-white font-bold text-base md:text-lg flex items-center gap-2">
          <img
            src="/img/icon-chat.png"
            alt="LiveSupport"
            className="h-6 w-6 rounded-full bg-white/80 p-1"
          />
          TDLC LiveSupport
        </div>
        <button
          onClick={() => {
            // Future: hide/minimize widget logic
          }}
          className="text-primary-100 text-2xl font-bold hover:text-red-300"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto p-4 bg-neutral-50"
        style={{ maxHeight: "38vh" }}
        tabIndex={0}
      >
        {conversation.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {pending && (
          <div className="flex justify-start mb-2">
            <div className="bg-blue-50 text-blue-900 px-4 py-2 rounded-2xl shadow text-sm animate-pulse">
              Typing…
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {/* Input */}
      <form
        className="flex items-center gap-2 border-t border-primary-100 bg-white p-2 rounded-b-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending && !escalated) handleSend(input);
        }}
        autoComplete="off"
      >
        <input
          type="text"
          className="flex-1 rounded-full border border-primary-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary-400"
          placeholder={
            escalated
              ? "A human agent will assist you…"
              : "Type your question (e.g., order status, returns, sizing)…"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={pending || escalated}
          tabIndex={0}
        />
        {!escalated ? (
          <button
            type="submit"
            className="bg-primary-700 text-white font-bold px-5 py-2 rounded-full hover:bg-primary-800 transition"
            disabled={pending}
            tabIndex={0}
          >
            Send
          </button>
        ) : (
          <button
            type="button"
            className="bg-amber-600 text-white font-bold px-5 py-2 rounded-full hover:bg-amber-700 transition"
            onClick={handleHumanEscalation}
            tabIndex={0}
          >
            Retry Human
          </button>
        )}
      </form>
      {/* Escalation state */}
      {escalated && (
        <div className="bg-amber-50 text-amber-800 text-sm px-4 py-3 border-t border-amber-200 rounded-b-2xl text-center">
          You’re now connected to a human agent. If chat is delayed, you may&nbsp;
          <a
            href="/contact"
            className="underline text-amber-900 font-bold hover:text-red-600"
            tabIndex={0}
          >
            submit a ticket here
          </a>
          .
        </div>
      )}
    </div>
  );
}
