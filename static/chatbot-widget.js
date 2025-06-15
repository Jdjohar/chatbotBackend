(function() {
  // Create widget container
  const widgetDiv = document.createElement('div');
  widgetDiv.id = 'chatbot-widget';
  document.body.appendChild(widgetDiv);

  // Get widget configuration
  const widgetScript = document.currentScript;
  const userId = widgetScript.dataset.userId;
  const apiKey = widgetScript.dataset.apiKey;
  const apiUrl = 'https://chatbotbackend-mpah.onrender.com';

  // Generate or retrieve visitorId
  let visitorId = localStorage.getItem('chatbot_visitor_id');
  if (!visitorId) {
    visitorId = 'visitor_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('chatbot_visitor_id', visitorId);
  }

  // Default settings
  const defaultSettings = {
    theme: '#1e3a8a',
    position: 'bottom-right',
    avatar: ''
  };

  // Function to apply styles
  function applyStyles(settings) {
    const style = document.createElement('style');
    style.textContent = `
      #chatbot-widget {
        position: fixed;
        ${settings.position === 'bottom-right' ? 'bottom: 20px; right: 20px;' : 'bottom: 20px; left: 20px;'}
        width: 300px;
        height: 400px;
        background: #fff;
        border-radius: 10px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        z-index: 1000;
        font-family: Arial, sans-serif;
      }
      #chatbot-header {
        background: ${settings.theme};
        color: white;
        padding: 10px;
        border-radius: 10px 10px 0 0;
        text-align: center;
      }
      #chatbot-messages {
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
      }
      .user {
        background: #e0f2fe;
        margin-left: 10%;
      }
      .bot {
        background: #f3f4f6;
        margin-right: 10%;
      }
    `;
    document.head.appendChild(style);
  }

  // Load React and ReactDOM
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
          loading: false
        };
        this.messagesEndRef = window.React.createRef();
      }

      componentDidMount() {
        this.fetchChats();
      }

      fetchChats = async () => {
        try {
          const res = await fetch(`${apiUrl}/chats?visitorId=${visitorId}`, {
            headers: { 'X-API-Key': apiKey }
          });
          if (!res.ok) throw new Error('Failed to fetch chats');
          const chats = await res.json();
          this.setState({
            messages: chats.flatMap(c => [
              { sender: 'user', text: c.message },
              ...(c.reply ? [{ sender: 'bot', text: c.reply }] : [])
            ])
          }, this.scrollToBottom);
        } catch (err) {
          console.error('Error fetching chats:', err);
          this.setState({
            messages: [...this.state.messages, { sender: 'bot', text: 'Error loading chat history. Please try again.' }]
          });
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

      scrollToBottom = () => {
        this.messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      };

      render() {
        const { messages, input, loading } = this.state;
        return e('div', null, [
          e('div', { id: 'chatbot-header' }, 'AI Assistant'),
          e('div', { id: 'chatbot-messages' }, 
            messages.map((msg, i) => 
              e('div', { key: i, className: `message ${msg.sender}` }, msg.text)
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

    fetch(`${apiUrl}/widget/settings/${userId}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch settings');
        return res.json();
      })
      .then(settings => {
        applyStyles(settings);
        window.ReactDOM.render(e(ChatbotWidget), widgetDiv);
      })
      .catch(err => {
        console.error('Settings fetch error:', err);
        applyStyles(defaultSettings);
        window.ReactDOM.render(e(ChatbotWidget), widgetDiv);
      });
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