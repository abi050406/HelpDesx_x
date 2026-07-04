import PageHeader from './PageHeader';
import { wikiArticles } from '../../data/helpdeskData';

function WikiPage() {
  return (
    <section className="module-page">
      <PageHeader title="Wiki TI" subtitle="Base de conocimiento para soluciones internas y casos especiales." actionLabel="+ Nuevo artículo" />
      <div className="module-toolbar"><input placeholder="Buscar solución documentada..." /><button>Buscar</button></div>
      <div className="wiki-grid">
        {wikiArticles.map((article) => (
          <article className="wiki-card" key={article.title}><span>{article.category}</span><h3>{article.title}</h3><p>Actualizado: {article.updated}</p><button>Abrir artículo →</button></article>
        ))}
      </div>
    </section>
  );
}

export default WikiPage;
