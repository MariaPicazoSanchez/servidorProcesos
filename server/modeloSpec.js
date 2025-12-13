const modelo = require("./modelo.js");


describe('El sistema', function() {
  let sistema;

  beforeEach(function() {
    sistema=new modelo.Sistema()
  });

  it('inicialmente no hay usuarios', function() {
    expect(sistema.numeroUsuarios()).toEqual(0);
  });

  it('permite agregar un usuario', function() {
    sistema.agregarUsuario("Mario");
    expect(sistema.numeroUsuarios()).toEqual(1);
  });

  it('obtenerUsuarios devuelve los usuarios añadidos', function() {
    sistema.agregarUsuario("Mario");
    sistema.agregarUsuario("Juan");
    let usuarios = Object.keys(sistema.obtenerUsuarios());
    expect(usuarios).toContain("Mario");
    expect(usuarios).toContain("Juan");
  });

  it('usuarioActivo devuelve true si existe', function() {
    sistema.agregarUsuario("Mario");
    expect(sistema.usuarioActivo("Mario")).toBe(true);
    expect(sistema.usuarioActivo("Juan")).toBe(false);
  });

  it('eliminarUsuario elimina correctamente al usuario', function() {
    sistema.agregarUsuario("Mario");
    sistema.eliminarUsuario("Mario");
    expect(sistema.usuarioActivo("Mario")).toBe(false);
  });
  
  it('numeroUsuarios devuelve el número correcto de usuarios', function() {
    sistema.agregarUsuario("Mario");
    sistema.agregarUsuario("Juan");
    expect(sistema.numeroUsuarios()).toEqual(2);
  });

  it('agregarUsuario no permite nicks duplicados', function() {
    sistema.agregarUsuario("Mario");
    let res = sistema.agregarUsuario("Mario");
    expect(res.nick).toEqual(-1);
    expect(sistema.numeroUsuarios()).toEqual(1);
  });

 

  it('registrarUsuario rechaza datos inválidos', function(done) {
    let obj = { email: "", password: "" };
    sistema.registrarUsuario(obj, function(res) {
      expect(res.email).toEqual(-1);
      done();
    });
  });

  
})

describe("Pruebas de las partidas", function(){
  let sistema, usr, usr2, usr3, usr4, usr5;

  beforeEach(function(){
    sistema = new modelo.Sistema();
    usr  = { nick: "Pepa", email: "pepa@pepa.es" };
    usr2 = { nick: "Pepo", email: "pepo@pepo.es" };
    usr3 = { nick: "Pepe", email: "pepe@pepe.es" };
    usr4 = { nick: "Pepo2", email: "pepo2@pepo.es" };
    usr5 = { nick: "Pepe2", email: "pepe2@pepe.es" };
    sistema.agregarUsuario(usr.email);
    sistema.agregarUsuario(usr2.email);
    sistema.agregarUsuario(usr3.email);
    sistema.agregarUsuario(usr4.email);
    sistema.agregarUsuario(usr5.email);
  });

  it("Usuarios y partidas en el sistema", function(){
    expect(sistema.numeroUsuarios()).toEqual(5);
    expect(sistema.obtenerPartidasDisponibles().length).toEqual(0);
  });

  it("Crear partida", function(){
    let codigo = sistema.crearPartida(usr.email);
    expect(codigo).not.toEqual(-1);
    let lista = sistema.obtenerPartidasDisponibles();
    expect(lista.length).toEqual(1);
    expect(lista[0].codigo).toEqual(codigo);
    expect(lista[0].propietario).toEqual(usr.email);
    expect(lista[0].propietarioEmail).toEqual(usr.email);
  });

  it("Unir a partida y completar aforo", function(){
    let codigo = sistema.crearPartida(usr.email);
    let res = sistema.unirAPartida(usr2.email, codigo);
    expect(res).toEqual(codigo);
    // completar hasta maxJug (UNO permite 4)
    let res3 = sistema.unirAPartida(usr3.email, codigo);
    let res4 = sistema.unirAPartida(usr4.email, codigo);
    expect(res3).toEqual(codigo);
    expect(res4).toEqual(codigo);
    let res5 = sistema.unirAPartida(usr5.email, codigo);
    expect(res5).toEqual(-1);
    expect(sistema.partidas[codigo].jugadores.length).toEqual(4);
  });

  it("Un usuario no puede estar dos veces en la misma partida", function(){
    let codigo = sistema.crearPartida(usr.email);
    let res1 = sistema.unirAPartida(usr2.email, codigo);
    let res2 = sistema.unirAPartida(usr2.email, codigo);
    expect(res1).toEqual(codigo);
    expect(res2).toEqual(-1);
  });

  it("Obtener partidas disponibles devuelve codigo y propietario", function(){
    let codigo = sistema.crearPartida(usr.email);
    let lista = sistema.obtenerPartidasDisponibles();
    expect(lista.some(p => p.codigo === codigo && p.propietario === usr.email)).toBe(true);
  });

  it("Continuar partida solo lo permite el propietario", function(){
    let codigo = sistema.crearPartida(usr.email);
    let intentoAjeno = sistema.continuarPartida(usr2.email, codigo);
    expect(intentoAjeno).toEqual(-1);
    expect(sistema.partidas[codigo].estado).toEqual("pendiente");
    let intentoPropietario = sistema.continuarPartida(usr.email, codigo);
    expect(intentoPropietario).toEqual(codigo);
    expect(sistema.partidas[codigo].estado).toEqual("enCurso");
  });

  it("Eliminar partida borra jugadores y elimina al quedar vacia", function(){
    let codigo = sistema.crearPartida(usr.email);
    sistema.unirAPartida(usr2.email, codigo);
    sistema.unirAPartida(usr3.email, codigo);
    // un jugador que no es propietario se puede salir sin borrar la partida
    sistema.eliminarPartida(usr2.email, codigo);
    expect(sistema.partidas[codigo].jugadores.map(j => j.email)).not.toContain(usr2.email);
    // el propietario la elimina definitivamente
    sistema.eliminarPartida(usr.email, codigo);
    expect(sistema.partidas[codigo]).toBeUndefined();
  });

  it("Obtener partidas disponibles filtra por juego y estado pendiente", function(){
    let uno = sistema.crearPartida(usr.email, "uno");
    let hundir = sistema.crearPartida(usr2.email, "hundir");
    sistema.continuarPartida(usr2.email, hundir); // pasa a enCurso, no debe mostrarse como disponible
    let disponiblesUno = sistema.obtenerPartidasDisponibles("uno");
    expect(disponiblesUno.map(p => p.codigo)).toContain(uno);
    expect(disponiblesUno.map(p => p.codigo)).not.toContain(hundir);
  });
});
