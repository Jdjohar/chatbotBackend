(function() {
  const widgetDiv = document.createElement('div');
  widgetDiv.id = 'chatbot-widget';
  document.body.appendChild(widgetDiv);

  const widgetScript = document.currentScript;
  const userId = widgetScript.dataset.userId;
  const apiKey = widgetScript.dataset.apiKey;
  const apiUrl = 'https://chatbotbackend-mpah.onrender.com';

  let visitorId = localStorage.getItem('chatbot_visitor_id');
  if (!visitorId) {
    visitorId = 'visitor_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('chatbot_visitor_id', visitorId);
  }

  const defaultSettings = {
    theme: '#1e3a8a',
    position: 'bottom-right',
    avatar: '',
    welcomeMessage: 'Hello! How can I assist you today?'
  };

  function applyStyles(settings, isMinimized) {
    const style = document.createElement('style');
    style.textContent = `
      #chatbot-widget {
        position: fixed;
        ${settings.position === 'bottom-right' ? 'bottom: 20px; right: 20px;' : 'bottom: 20px; left: 20px;'}
        ${isMinimized ? `
          width: 60px;
          height: 60px;
          background: ${settings.theme};
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        ` : `
          width: 300px;
          height: 400px;
          background: #fff;
          border-radius: 10px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.2);
          z-index: 1000;
          font-family: Arial, sans-serif;
          display: flex;
          flex-direction: column;
        `}
      }
      #chatbot-minimized-icon {
        color: white;
        font-size: 24px;
      }
      #chatbot-header {
        background: ${settings.theme};
        color: white;
        padding: 10px;
        border-radius: 10px 10px 0 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      #chatbot-avatar {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        object-fit: cover;
        margin-right: 10px;
      }
      #chatbot-title {
        flex: 1;
        text-align: center;
      }
      #chatbot-minimize-btn {
        background: none;
        border: none;
        color: white;
        font-size: 16px;
        cursor: pointer;
      }
      #chatbot-messages {
        flex: 1;
        height: 300px;
        overflow-y: auto;
        padding: 10px;
      }
      #chatbot-input {
        display: flex;
        padding: 10px;
        border-top: 1px solid #ddd;
      }
      #chatbot-input input {
        flex: 1;
        padding: 8px;
        border: 1px solid #ddd;
        border-radius: 5px;
      }
      #chatbot-input button {
        padding: 8px 12px;
        margin-left: 5px;
        background: ${settings.theme};
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
      }
      .message {
        margin: 5px 0;
        padding: 8px;
        border-radius: 5px;
        display: flex;
        align-items: center;
      }
      .user {
        background: #e0f2fe;
        margin-left: 10%;
      }
      .bot {
        background: #f3f4f6;
        margin-right: 10%;
      }
      .bot img {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-right: 5px;
      }
    `;
    document.head.appendChild(style);
  }

  const scripts = [
    { src: 'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js', loaded: false },
    { src: 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js', loaded: false }
  ];

  let scriptsLoaded = 0;
  function renderWidget() {
    if (!window.React || !window.ReactDOM || !window.React.Component) {
      widgetDiv.innerHTML = '<div style="padding: 10px; color: red;">Failed to load chatbot dependencies.</div>';
      return;
    }

    const e = window.React.createElement;
    class ChatbotWidget extends window.React.Component {
      constructor(props) {
        super(props);
        this.state = {
          messages: [],
          input: '',
          loading: false,
          isMinimized: false,
          settings: defaultSettings
        };
        this.messagesEndRef = window.React.createRef();
      }

      componentDidMount() {
        this.fetchSettings();
      }

      fetchSettings = async () => {
        try {
          const res = await fetch(`${apiUrl}/widget/settings/${userId}`);
          if (!res.ok) throw new Error('Failed to fetch settings');
          const settings = await res.json();
          this.setState({ settings }, () => {
            applyStyles(settings, this.state.isMinimized);
            this.addWelcomeMessage();
            this.fetchChats();
          });
        } catch (err) {
          console.error('Settings fetch error:', err);
          applyStyles(defaultSettings, this.state.isMinimized);
          this.addWelcomeMessage();
          this.fetchChats();
        }
      };

      addWelcomeMessage = () => {
        this.setState(prevState => ({
          messages: [{ sender: 'bot', text: prevState.settings.welcomeMessage }]
        }));
      };

      fetchChats = async () => {
        try {
          const res = await fetch(`${apiUrl}/chats?visitorId=${visitorId}`, {
            headers: { 'X-API-Key': apiKey }
          });
          if (!res.ok) throw new Error('Failed to fetch chats');
          const chats = await res.json();
          this.setState(prevState => ({
            messages: [
              { sender: 'bot', text: prevState.settings.welcomeMessage },
              ...chats.flatMap(c => [
                { sender: 'user', text: c.message },
                ...(c.reply ? [{ sender: 'bot', text: c.reply }] : [])
              ])
            ]
          }), this.scrollToBottom);
        } catch (err) {
          console.error('Error fetching chats:', err);
          this.setState(prevState => ({
            messages: [
              ...prevState.messages,
              { sender: 'bot', text: 'Error loading chat history. Please try again.' }
            ]
          }));
        }
      };

      sendMessage = async () => {
        const { input, messages } = this.state;
        if (!input.trim()) return;
        this.setState({ 
          loading: true, 
          messages: [...messages, { sender: 'user', text: input }],
          input: ''
        }, this.scrollToBottom);
        try {
          const res = await fetch(`${apiUrl}/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey
            },
            body: JSON.stringify({ message: input, visitorId })
          });
          if (!res.ok) throw new Error('Failed to send message');
          const { reply } = await res.json();
          this.setState({
            messages: [...this.state.messages, { sender: 'bot', text: reply }],
            loading: false
          }, this.scrollToBottom);
        } catch (err) {
          console.error('Error sending message:', err);
          this.setState({
            messages: [...this.state.messages, { sender: 'bot', text: 'Error contacting server. Please try again.' }],
            loading: false
          }, this.scrollToBottom);
        }
      };

      toggleMinimize = () => {
        this.setState(prevState => {
          const isMinimized = !prevState.isMinimized;
          applyStyles(prevState.settings, isMinimized);
          return { isMinimized };
        });
      };

      scrollToBottom = () => {
        this.messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      };

      render() {
        const { messages, input, loading, isMinimized, settings } = this.state;
        if (isMinimized) {
          return e('div', { onClick: this.toggleMinimize }, [
            e('span', { id: 'chatbot-minimized-icon' }, '💬')
          ]);
        }
        return e('div', null, [
          e('div', { id: 'chatbot-header' }, [
            settings.avatar ? e('img', { id: 'chatbot-avatar', src: settings.avatar, alt: 'Avatar' }) : null,
            e('span', { id: 'chatbot-title' }, 'AI Assistant'),
            e('button', { id: 'chatbot-minimize-btn', onClick: this.toggleMinimize }, '−')
          ]),
          e('div', { id: 'chatbot-messages' }, 
            messages.map((msg, i) => 
              e('div', { key: i, className: `message ${msg.sender}` }, [
                msg.sender === 'bot' && settings.avatar ? e('img', { src: settings.avatar, alt: 'Bot' }) : null,
                e('span', null, msg.text)
              ])
            ),
            loading ? e('div', { className: 'message bot' }, '...') : null,
            e('div', { ref: this.messagesEndRef })
          ),
          e('div', { id: 'chatbot-input' }, [
            e('input', {
              type: 'text',
              value: input,
              onChange: e => this.setState({ input: e.target.value }),
              onKeyPress: e => e.key === 'Enter' && this.sendMessage(),
              placeholder: 'Type your message...',
              disabled: loading
            }),
            e('button', { onClick: this.sendMessage, disabled: loading }, 'Send')
          ])
        ]);
      }
    }

    window.ReactDOM.render(e(ChatbotWidget), widgetDiv);
  }

  function onScriptLoad() {
    scriptsLoaded++;
    if (scriptsLoaded === scripts.length) {
      renderWidget();
    }
  }

  function onScriptError() {
    widgetDiv.innerHTML = '<div style="padding: 10px; color: red;">Failed to load chatbot dependencies. Please try again later.</div>';
  }

  scripts.forEach(script => {
    const scriptTag = document.createElement('script');
    scriptTag.src = script.src;
    scriptTag.async = true;
    scriptTag.onload = () => {
      script.loaded = true;
      onScriptLoad();
    };
    scriptTag.onerror = onScriptError;
    document.head.appendChild(scriptTag);
  });
})();