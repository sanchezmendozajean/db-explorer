import { defineConfig } from 'vitepress';

const REPO = 'https://github.com/sanchezmendozajean/db-explorer';
const BASE = '/db-explorer/docs/';

// Slug por defecto de VitePress, más la puntuación española (¿ ¡ « ») para que las anclas queden limpias.
const SPECIAL = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/¿¡«»]+/g;
function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(SPECIAL, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();
}

// Documentación de usuario. Se genera en ../site/docs para que el flujo de Pages la publique junto a la portada.
export default defineConfig({
  lang: 'es',
  title: 'DB Explorer',
  titleTemplate: ':title · Documentación de DB Explorer',
  description:
    'Guía de uso de DB Explorer, el cliente de escritorio para PostgreSQL, MariaDB/MySQL, SQLite y SQL Server.',
  base: BASE,
  outDir: '../site/docs',
  cleanUrls: true,
  appearance: true,

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${BASE}icon.png` }],
    ['meta', { name: 'theme-color', content: '#14161b' }],
  ],

  markdown: {
    anchor: { slugify },
    container: {
      tipLabel: 'Consejo',
      infoLabel: 'Información',
      warningLabel: 'Atención',
      dangerLabel: 'Cuidado',
      detailsLabel: 'Detalles',
    },
  },

  themeConfig: {
    logo: '/icon.png',
    siteTitle: 'DB Explorer',

    nav: [
      { text: 'Inicio', link: 'https://sanchezmendozajean.github.io/db-explorer/', target: '_self' },
      { text: 'Guía', link: '/', activeMatch: '^/(?!atajos|preguntas-frecuentes)' },
      { text: 'Descargar', link: `${REPO}/releases/latest` },
    ],

    sidebar: [
      {
        text: 'Primeros pasos',
        items: [
          { text: 'Introducción', link: '/' },
          { text: 'La interfaz', link: '/interfaz' },
          { text: 'Conexiones', link: '/conexiones' },
        ],
      },
      {
        text: 'Explorar',
        items: [
          { text: 'El árbol de objetos', link: '/arbol' },
          { text: 'Tablas y vistas', link: '/objetos' },
          { text: 'Procedimientos y funciones', link: '/rutinas' },
          { text: 'Administrar bases de datos', link: '/administrar-bases' },
        ],
      },
      {
        text: 'Consultar',
        items: [
          { text: 'El editor SQL', link: '/editor' },
          { text: 'Ejecutar consultas', link: '/ejecucion' },
          { text: 'Plan de ejecución', link: '/plan' },
          { text: 'Resultados', link: '/resultados' },
          { text: 'Editar datos', link: '/edicion' },
          { text: 'Copiar y exportar', link: '/exportar' },
          { text: 'Formatos de datos', link: '/formatos' },
          { text: 'Historial y mensajes', link: '/historial' },
        ],
      },
      {
        text: 'Tu trabajo',
        items: [
          { text: 'Scripts y espacio de trabajo', link: '/espacio-de-trabajo' },
          { text: 'La vista Archivos', link: '/archivos' },
          { text: 'Preferencias', link: '/preferencias' },
          { text: 'Seguridad', link: '/seguridad' },
        ],
      },
      {
        text: 'Referencia',
        items: [
          { text: 'Atajos de teclado', link: '/atajos' },
          { text: 'Preguntas frecuentes', link: '/preguntas-frecuentes' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: REPO, ariaLabel: 'Código en GitHub' }],

    editLink: {
      pattern: `${REPO}/edit/main/site-docs/:path`,
      text: 'Editar esta página en GitHub',
    },

    footer: {
      message: `Licencia MIT · <a href="${REPO}/issues">Reportar un problema</a>`,
      copyright: 'Hecho por Jean Sánchez Mendoza',
    },

    outline: { level: [2, 3], label: 'En esta página' },
    docFooter: { prev: 'Anterior', next: 'Siguiente' },
    darkModeSwitchLabel: 'Apariencia',
    lightModeSwitchTitle: 'Cambiar a tema claro',
    darkModeSwitchTitle: 'Cambiar a tema oscuro',
    sidebarMenuLabel: 'Menú',
    returnToTopLabel: 'Volver arriba',
    externalLinkIcon: true,
    notFound: {
      title: 'Página no encontrada',
      quote: 'Esta página no existe o cambió de dirección.',
      linkLabel: 'Ir al inicio de la documentación',
      linkText: 'Ir al inicio',
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar en la documentación' },
          modal: {
            displayDetails: 'Mostrar detalles',
            resetButtonTitle: 'Borrar la búsqueda',
            backButtonTitle: 'Cerrar la búsqueda',
            noResultsText: 'Sin resultados para',
            footer: {
              selectText: 'abrir',
              selectKeyAriaLabel: 'Enter',
              navigateText: 'moverse',
              navigateUpKeyAriaLabel: 'Flecha arriba',
              navigateDownKeyAriaLabel: 'Flecha abajo',
              closeText: 'cerrar',
              closeKeyAriaLabel: 'Esc',
            },
          },
        },
      },
    },
  },
});
