(function() {
  const widgetDiv = document.createElement('div');
  widgetDiv.id = 'chatbot-widget';
  document.body.appendChild(widgetDiv);

  // Fetch widget settings
  const widgetScript = document.currentScript;
  const userId = widgetScript.dataset.userId;
  const apiKey = widgetScript.dataset.apiKey;
  const apiUrl = 'https://chatbotbackend-mpah.onrender.com';

  fetch(`${apiUrl}/widget/settings/${userId}`)
    .then(res => res.json())
    .then(settings => {
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
    });

  const scripts = [
    'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
    'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js'
  ];
  scripts.forEach(src => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    document.head.appendChild(script);
  });

  const e = React.createElement;
  class ChatbotWidget extends React.Component {
    constructor(props) {
      super(props);
      this.state = {
        messages: [],
        input: '',
        loading: false
      };
      this.messagesEndRef = React.createRef();
    }

    componentDidMount() {
      this.fetchChats();
    }

    fetchChats = async () => {
      try {
        const res = await fetch(`${apiUrl}/chats`, {
          headers: { 'X-API-Key': apiKey }
        });
        const chats = await res.json();
        this.setState({
          messages: chats.flatMap(c => [
            { sender: 'user', text: c.message },
            ...(c.reply ? [{ sender: 'bot', text: c.reply }] : [])
          ])
        }, this.scrollToBottom);
      } catch (err) {
        console.error('Error fetching chats:', err);
      }
    };

    sendMessage = async () => {
      const { input, messages } = this.state;
      if (!input.trim()) return;
      this.setState({ loading: true, messages: [...messages, { sender: 'user', text: input }] }, this.scrollToBottom);
      try {
        const res = await fetch(`${apiUrl}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey
          },
          body: JSON.stringify({ message: input })
        });
        const { reply } = await res.json();
        this.setState({
          messages: [...this.state.messages, { sender: 'bot', text: reply }],
          input: '',
          loading: false
        }, this.scrollToBottom);
      } catch (err) {
        this.setState({ loading: false });
        console.error('Error sending message:', err);
      }
    };

    scrollToBottom = () => {
      this.messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    render() {
      const { messages, input, loading } = this.state;
      return e('div', null, [
        e('div', { id: 'chatbot-header' }, 'AI Assistant'),
        e('div', { id: 'chatbot-messages' }, messages.map((msg, i) =>
          e('div', { key: i, className: `message ${msg.sender}` }, msg.text)
        ), e('div', { ref: this.messagesEndRef })),
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

  const renderWidget = () => {
    if (window.React && window.ReactDOM) {
      ReactDOM.render(e(ChatbotWidget), document.getElementById('chatbot-widget'));
    } else {
      setTimeout(renderWidget, 100);
    }
  };
  renderWidget();
})();