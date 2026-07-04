function PageHeader({ title, subtitle, actionLabel, onAction }) {
  return (
    <div className="module-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actionLabel ? <button className="primary-action" onClick={onAction}>{actionLabel}</button> : null}
    </div>
  );
}

export default PageHeader;
