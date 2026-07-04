function Notification({ item }) {
  return (
    <div className={`notification ${item.type}`}>
      <div className="notification-icon">!</div>
      <div><strong>{item.title}</strong><p>{item.text}</p></div>
      <small>{item.time}</small>
    </div>
  );
}

export default Notification;
