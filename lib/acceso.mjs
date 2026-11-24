export function correoDeUsuario(usuario, dominio = 'equipo2.example.com') {
  const nombre = typeof usuario === 'string' ? usuario.trim().toLowerCase() : '';
  return /^[a-z][a-z0-9_]{2,39}$/.test(nombre) && nombre + '@' + dominio;
}
