import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { marked } from "marked";
import { 
  auth, db, signIn, logOut, onAuthStateChanged,
  collection, doc, addDoc, getDoc, getDocs, query, where, orderBy, onSnapshot, serverTimestamp, updateDoc, deleteDoc, limit 
} from "./firebase.ts";

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// DOM Elements
const app = document.getElementById('app');
const loginOverlay = document.getElementById('login-overlay');
const loginButton = document.getElementById('login-button');
const logoutButton = document.getElementById('logout-button');
const chatContainer = document.getElementById('chat-container');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const chatHistory = document.getElementById('chat-history');
const newChatBtn = document.getElementById('new-chat-btn');
const currentChatTitle = document.getElementById('current-chat-title');
const emptyState = document.getElementById('empty-state');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebar = document.getElementById('sidebar');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const searchChats = document.getElementById('search-chats');
const modelSelector = document.getElementById('model-selector');
const toolWeb = document.getElementById('tool-web');
const toolImage = document.getElementById('tool-image');
const toolVideo = document.getElementById('tool-video');

// User Profile Elements
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const userEmail = document.getElementById('user-email');

// State
let currentUser = null;
let currentChatId = null;
let unsubscribeMessages = null;
let unsubscribeChats = null;
let allChats = [];

// Update Theme based on Model
function updateModelTheme() {
  const model = modelSelector.value;
  app.classList.remove('theme-normal', 'theme-pro', 'theme-ultra');
  if (model === 'gemini-3.1-flash-lite-preview') app.classList.add('theme-normal');
  else if (model === 'gemini-3-flash-preview') app.classList.add('theme-pro');
  else if (model === 'gemini-3.1-pro-preview') app.classList.add('theme-ultra');
}

modelSelector.addEventListener('change', updateModelTheme);
updateModelTheme(); // Initial theme set

// Configure Marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

// --- Auth Logic ---

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    loginOverlay.classList.add('hidden');
    app.classList.remove('hidden');
    
    // Update Profile
    userAvatar.src = user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`;
    userName.textContent = user.displayName;
    userEmail.textContent = user.email;
    
    // Load Chats
    loadChatHistory();
  } else {
    currentUser = null;
    loginOverlay.classList.remove('hidden');
    app.classList.add('hidden');
    
    // Complete Reset
    currentChatId = null;
    currentChatTitle.textContent = "New Chat";
    chatContainer.innerHTML = '';
    chatContainer.appendChild(emptyState);
    emptyState.classList.remove('hidden');
    chatHistory.innerHTML = '';
    searchChats.value = '';
    allChats = [];
    
    if (unsubscribeMessages) unsubscribeMessages();
    if (unsubscribeChats) unsubscribeChats();
  }
});

loginButton.addEventListener('click', signIn);
logoutButton.addEventListener('click', logOut);

// --- Chat History Logic ---

function loadChatHistory() {
  if (unsubscribeChats) unsubscribeChats();
  
  const q = query(
    collection(db, "chats"),
    where("userId", "==", currentUser.uid),
    orderBy("updatedAt", "desc")
  );
  
  unsubscribeChats = onSnapshot(q, (snapshot) => {
    allChats = [];
    snapshot.forEach((doc) => {
      allChats.push({ id: doc.id, ...doc.data() });
    });
    renderChatHistory(allChats);
  });
}

function renderChatHistory(chats) {
  chatHistory.innerHTML = '';
  chats.forEach((chat) => {
    const item = createChatHistoryItem(chat.id, chat);
    chatHistory.appendChild(item);
  });
}

// Search Functionality
searchChats.addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();
  const filtered = allChats.filter(chat => chat.title.toLowerCase().includes(term));
  renderChatHistory(filtered);
});

function createChatHistoryItem(id, chat) {
  const div = document.createElement('div');
  div.className = `chat-history-item group ${id === currentChatId ? 'active' : ''}`;
  div.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-slate-500"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
    <span class="flex-1 truncate text-sm">${chat.title}</span>
    <button class="delete-chat" data-id="${id}">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
    </button>
  `;
  
  div.addEventListener('click', (e) => {
    if (e.target.closest('.delete-chat')) {
      deleteChatSession(id);
    } else {
      switchChat(id, chat.title);
    }
  });
  
  return div;
}

async function createNewChat() {
  if (!currentUser) return;
  
  const newChat = {
    title: "New Chat",
    userId: currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  
  const docRef = await addDoc(collection(db, "chats"), newChat);
  switchChat(docRef.id, "New Chat");
}

function switchChat(id, title) {
  if (currentChatId === id) return;
  
  currentChatId = id;
  currentChatTitle.textContent = title;
  sidebar.classList.remove('show'); // Close mobile sidebar
  
  // Update active state in UI
  document.querySelectorAll('.chat-history-item').forEach(item => {
    item.classList.toggle('active', item.querySelector('.delete-chat').dataset.id === id);
  });
  
  loadMessages(id);
}

async function deleteChatSession(id) {
  if (confirm("Are you sure you want to delete this chat?")) {
    await deleteDoc(doc(db, "chats", id));
    if (currentChatId === id) {
      clearChat();
    }
  }
}

function clearChat() {
  currentChatId = null;
  currentChatTitle.textContent = "New Chat";
  chatContainer.innerHTML = '';
  chatContainer.appendChild(emptyState);
  if (unsubscribeMessages) unsubscribeMessages();
}

// --- Messages Logic ---

function loadMessages(chatId) {
  if (unsubscribeMessages) unsubscribeMessages();
  
  chatContainer.innerHTML = '';
  emptyState.classList.add('hidden');
  
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("createdAt", "asc")
  );
  
  unsubscribeMessages = onSnapshot(q, (snapshot) => {
    // Only clear if it's the initial load or a reset
    if (snapshot.metadata.hasPendingWrites) return;
    
    chatContainer.innerHTML = '';
    if (snapshot.empty) {
      emptyState.classList.remove('hidden');
      chatContainer.appendChild(emptyState);
    } else {
      emptyState.classList.add('hidden');
      snapshot.forEach((doc) => {
        const msg = doc.data();
        appendMessage(msg.content, msg.role === 'user', msg.toolType);
      });
      scrollToBottom();
    }
  });
}

function appendMessage(content, isUser = false, toolType = null) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message group ${isUser ? 'user' : 'ai'}`;
  if (toolType) messageDiv.classList.add(`tool-${toolType}`);
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  
  if (isUser) {
    contentDiv.textContent = content;
  } else {
    if (toolType) {
      const badge = document.createElement('div');
      badge.className = `tool-badge tool-badge-${toolType}`;
      badge.textContent = toolType === 'web' ? 'Web Answer' : toolType === 'image' ? 'Image Prompt' : 'Video Idea';
      messageDiv.prepend(badge);
    }

    contentDiv.innerHTML = marked.parse(content);
    
    // Add Copy Button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    copyBtn.addEventListener('click', () => {
      const currentContent = contentDiv.getAttribute('data-raw-content') || content;
      copyToClipboard(currentContent);
    });
    messageDiv.appendChild(copyBtn);
  }
  
  messageDiv.appendChild(contentDiv);
  chatContainer.appendChild(messageDiv);
  return contentDiv;
}

function createTypingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator message ai';
  indicator.id = 'typing-indicator';
  indicator.innerHTML = `
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  `;
  return indicator;
}

function createLoadingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'loading-indicator';
  indicator.id = 'loading-indicator';
  indicator.innerHTML = `
    <svg class="animate-spin h-4 w-4 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    <span>AI is thinking...</span>
  `;
  return indicator;
}

function showError(message, type = 'general') {
  let specificMessage = message;
  if (type === 'api') {
    if (message.includes('API_KEY_INVALID')) {
      specificMessage = "Invalid API Key. Please check your Gemini API key configuration.";
    } else if (message.includes('network') || message.includes('fetch')) {
      specificMessage = "Network error. Please check your internet connection and try again.";
    } else if (message.includes('quota') || message.includes('429')) {
      specificMessage = "Rate limit exceeded. Please wait a moment before trying again.";
    } else {
      specificMessage = "Gemini API error: " + message;
    }
  }

  const errorDiv = document.createElement('div');
  errorDiv.className = 'message ai border-red-500/50 bg-red-500/10 text-red-200';
  errorDiv.innerHTML = `
    <div class="flex items-center gap-2 mb-1">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-400"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <span class="font-bold text-xs uppercase tracking-wider">Error</span>
    </div>
    <p class="text-sm">${specificMessage}</p>
  `;
  chatContainer.appendChild(errorDiv);
  scrollToBottom();
}

// --- Interaction Logic ---

async function handleToolClick(toolType) {
  if (!currentUser) return;
  
  let prompt = "";
  if (toolType === 'web') {
    prompt = "Search the web and provide a comprehensive answer about: ";
  } else if (toolType === 'image') {
    prompt = "Generate a highly detailed AI image generation prompt for: ";
  } else if (toolType === 'video') {
    prompt = "Create a viral video script and concept for: ";
  }
  
  chatInput.value = prompt;
  chatInput.focus();
  // Trigger auto-resize
  chatInput.dispatchEvent(new Event('input'));
}

toolWeb.addEventListener('click', () => handleToolClick('web'));
toolImage.addEventListener('click', () => handleToolClick('image'));
toolVideo.addEventListener('click', () => handleToolClick('video'));

async function handleSubmit(e) {
  e.preventDefault();
  
  const content = chatInput.value.trim();
  if (!content) return;
  
  // If no chat selected, create one
  if (!currentChatId) {
    await createNewChat();
  }
  
  const chatId = currentChatId;
  const selectedModel = modelSelector.value;
  
  // Detect tool usage
  let toolType = null;
  if (content.startsWith("Search the web")) toolType = 'web';
  else if (content.startsWith("Generate a highly detailed AI image")) toolType = 'image';
  else if (content.startsWith("Create a viral video script")) toolType = 'video';

  // Clear input
  chatInput.value = '';
  chatInput.style.height = 'auto';
  chatInput.disabled = true;
  sendButton.disabled = true;
  
  // Save user message
  try {
    await addDoc(collection(db, "chats", chatId, "messages"), {
      role: 'user',
      content: content,
      createdAt: serverTimestamp(),
      toolType: toolType // Store tool type for persistence
    });
    
    // Update chat title if it's the first message
    const messagesSnap = await getDocs(query(collection(db, "chats", chatId, "messages"), limit(2)));
    if (messagesSnap.size === 1) {
      // Improved title logic: first 3-5 words, cleaned up
      const cleanContent = content.replace(/[^\w\s]/gi, '').trim();
      const words = cleanContent.split(/\s+/).filter(w => w.length > 0).slice(0, 5);
      let title = words.join(" ");
      if (content.split(/\s+/).length > 5) title += "...";
      if (!title) title = "New Chat"; // Fallback for emoji-only or symbol-only prompts
      
      await updateDoc(doc(db, "chats", chatId), { 
        title: title,
        updatedAt: serverTimestamp()
      });
      currentChatTitle.textContent = title;
    } else {
      await updateDoc(doc(db, "chats", chatId), { updatedAt: serverTimestamp() });
    }
    
    // Show loading indicator
    const loadingIndicator = createLoadingIndicator();
    chatContainer.appendChild(loadingIndicator);
    scrollToBottom();
    
    // Get History for Gemini
    const historySnap = await getDocs(query(
      collection(db, "chats", chatId, "messages"),
      orderBy("createdAt", "asc")
    ));
    
    const contents = historySnap.docs.map(doc => ({
      role: doc.data().role,
      parts: [{ text: doc.data().content }]
    }));
    
    // Switch to typing indicator after a brief delay or when starting API call
    const typingTimeout = setTimeout(() => {
      if (document.getElementById('loading-indicator')) {
        loadingIndicator.remove();
        const typingIndicator = createTypingIndicator();
        chatContainer.appendChild(typingIndicator);
        scrollToBottom();
      }
    }, 500);

    // System Instructions and Config based on model
    let systemInstruction = "You are a helpful AI assistant.";
    let generationConfig = { systemInstruction };

    if (selectedModel === "gemini-3.1-flash-lite-preview") {
      generationConfig = {
        systemInstruction: "You are the 'Normal' AI model. Your primary goal is speed and extreme brevity. Keep responses as short as possible. Use bullet points for lists. Avoid conversational filler (e.g., 'Sure, I can help with that'). Answer directly and move on.",
        temperature: 0.1,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }
      };
    } else if (selectedModel === "gemini-3-flash-preview") {
      generationConfig = {
        systemInstruction: "You are the 'Pro' AI model. Your goal is to be creative, engaging, and helpful. Use a friendly and professional tone. Provide creative solutions and interesting analogies. Structure your responses with clear sections. Feel free to elaborate to provide a better user experience.",
        temperature: 0.8,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
      };
    } else if (selectedModel === "gemini-3.1-pro-preview") {
      generationConfig = {
        systemInstruction: "You are the 'Ultra' AI model. Your goal is maximum depth, accuracy, and rigorous analysis. Provide comprehensive, multi-perspective answers. Use structured headings and sub-headings. Show your step-by-step reasoning for complex problems. Be precise with technical details and data. If there are multiple ways to solve a problem, explain the pros and cons of each.",
        temperature: 0.9,
        // thinkingLevel defaults to HIGH for Pro models
      };
    }

    // Call Gemini with Streaming
    const responseStream = await ai.models.generateContentStream({
      model: selectedModel,
      contents: contents,
      config: generationConfig
    });
    
    clearTimeout(typingTimeout);
    const typingIndicator = document.getElementById('typing-indicator');
    const loadingIndicatorFinal = document.getElementById('loading-indicator');
    if (typingIndicator) typingIndicator.remove();
    if (loadingIndicatorFinal) loadingIndicatorFinal.remove();

    // Create placeholder for AI response
    const aiContentDiv = appendMessage("", false, toolType);
    let fullAiResponse = "";

    for await (const chunk of responseStream) {
      const chunkText = chunk.text;
      if (chunkText) {
        fullAiResponse += chunkText;
        aiContentDiv.innerHTML = marked.parse(fullAiResponse);
        aiContentDiv.setAttribute('data-raw-content', fullAiResponse);
        scrollToBottom();
      }
    }
    
    // Save AI message to Firestore after stream completes
    await addDoc(collection(db, "chats", chatId, "messages"), {
      role: 'model',
      content: fullAiResponse,
      createdAt: serverTimestamp(),
      toolType: toolType
    });
    
  } catch (error) {
    console.error('Gemini/Firebase Error:', error);
    const typingIndicator = document.getElementById('typing-indicator');
    const loadingIndicator = document.getElementById('loading-indicator');
    if (typingIndicator) typingIndicator.remove();
    if (loadingIndicator) loadingIndicator.remove();
    showError(error.message || String(error), 'api');
  } finally {
    chatInput.disabled = false;
    sendButton.disabled = false;
    chatInput.focus();
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast("Copied to clipboard!");
  });
}

function showToast(message) {
  toastMessage.textContent = message;
  toast.classList.remove('opacity-0', 'translate-y-4');
  toast.classList.add('opacity-100', 'translate-y-0');
  
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-4');
    toast.classList.remove('opacity-100', 'translate-y-0');
  }, 2000);
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// --- Event Listeners ---

chatForm.addEventListener('submit', handleSubmit);

newChatBtn.addEventListener('click', createNewChat);

mobileMenuBtn.addEventListener('click', () => {
  sidebar.classList.toggle('show');
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = (chatInput.scrollHeight) + 'px';
});

// Handle Enter to submit (Shift+Enter for new line)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
});

// Close mobile sidebar on outside click
document.addEventListener('click', (e) => {
  if (window.innerWidth < 768 && 
      !sidebar.contains(e.target) && 
      !mobileMenuBtn.contains(e.target) && 
      sidebar.classList.contains('show')) {
    sidebar.classList.remove('show');
  }
});
