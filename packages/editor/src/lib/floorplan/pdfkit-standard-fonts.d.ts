// pdfkit 0.20 ships these entry points without types, and @types/pdfkit predates them.
declare module 'pdfkit/standard-fonts/*' {
  const font: unknown
  export default font
}
