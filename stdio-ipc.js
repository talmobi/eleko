const net = require( 'net' )
const path = require( 'path' )
const rimraf = require( 'rimraf' )

const eeto = require( 'eeto' )

module.exports.create = create
module.exports.listen = listen

const _ipcPaths = []
function clean () {
  for ( let i = 0; i < _ipcPaths.length; i++ ) {
    const p = _ipcPaths[ i ]
    rimraf.sync( p )
  }
}

process.on( 'close', clean )

// ref: https://nodejs.org/api/net.html#net_identifying_paths_for_ipc_connections
function getIPCPath ( name ) {
  let ipcPath

  name = String( 'ipc[' + name + ']' )

  if ( process.platform === 'win32' ) {
    return path.join( '\\\\.\\pipe', __dirname, name + 'pipe' )
  }

  ipcPath = path.join( __dirname, name + '.pipe' )
  // delete in unix as it's not automatically cleaned up
  rimraf.sync( ipcPath )

  return ipcPath
}

function listen ( name ) {
  return new Promise ( function ( resolve, reject ) {
    const ipcPath = getIPCPath( name )
    console.log( 'listen:name:' + name )

    const api = eeto()

    connect()
    function connect () {
      setTimeout( function () {
        const socket = net.connect( ipcPath )
        socket.once( 'connect', function () {
          console.log( 'listen:connected' )
          api.socket = socket
          api.emit( 'connected' )
          resolve( api )
        } )
        socket.once( 'error', function () {
          connect()
        } )
      }, 250 )
    }

    api.buffer = ''

    api.ids = 1
    api.promises = []

    api._ready = false
    api._messages = []

    function attach () {
      api.socket.on( 'data', function api_onData ( chunk ) {
        onData( api, chunk )
      } )
    }

    api.parseMessage = function api_parseMessage ( jsonString ) {
      const json = JSON.parse( jsonString )
      api._messages.push( json )
      drain()
    }

    api.send = function api_send ( json ) {
      return send( api, json )
    }

    api.promise = function api_promise ( json ) {
      return promise( api, json )
    }

    api.once( 'ready', function () {
      api._ready = true
      drain()
    } )

    api.once( 'connected', function () {
      attach()
      drain()
    } )

    function drain () {
      if ( !api._ready ) return

      const messages = api._messages
      api._messages = []
      for ( let i = 0; i < messages.length; i++ ) {
        const evt = messages[ i ]

        switch ( evt.type ) {
          case 'promise':
            {
              function callback ( err, data ) {
                if ( callback.done ) return
                callback.done = true
                api.send( {
                  type: 'promise:response',
                  id: evt.id,
                  error: err,
                  content: data
                } )
              }

              const p = {
                resolve: function ( data ) {
                  callback( undefined, data )
                },
                reject: function ( err ) {
                  callback( err )
                },
                data: evt.content
              }

              api.emit( 'promise', p )
            }
            break

          case 'promise:response':
            {
              const p = api.promises[ evt.id ]
              delete api.promises[ evt.id ]
              if ( evt.error ) {
                p.reject( evt.error )
              } else {
                // console.log( evt )
                // console.log( 'promise content: ' + evt.content )
                p.resolve( evt.content )
              }
            }
            break

          default:
            api.emit( evt.type, evt.content )
        }
      }
    }

    return api
  } )
}


function create ( stdread, stdwrite ) {
  const api = eeto()
  api.stdread = stdread
  api.stdwrite = stdwrite
  api.buffer = ''

  api.ids = 1
  api.promises = []

  api._ready = false
  api._messages = []

  attach()
  function attach () {
    api.stdread.on( 'data', function api_onData ( chunk ) {
      onData( api, chunk )
    } )
  }

  api.parseMessage = function api_parseMessage ( jsonString ) {
    const json = JSON.parse( jsonString )
    api._messages.push( json )
    drain()
  }

  api.send = function api_send ( json ) {
    return send( api, json )
  }

  api.promise = function api_promise ( json ) {
    return promise( api, json )
  }

  api.once( 'ready', function () {
    api._ready = true
    drain()
  } )

  function drain () {
    if ( !api._ready ) return

    const messages = api._messages
    api._messages = []
    for ( let i = 0; i < messages.length; i++ ) {
      const evt = messages[ i ]

      switch ( evt.type ) {
        case 'promise':
          {
            function callback ( err, data ) {
              if ( callback.done ) return
              callback.done = true
              api.send( {
                type: 'promise:response',
                id: evt.id,
                error: err,
                content: data
              } )
            }

            const p = {
              resolve: function ( data ) {
                callback( undefined, data )
              },
              reject: function ( err ) {
                callback( err )
              },
              data: evt.content
            }

            api.emit( 'promise', p )
          }
          break

        case 'promise:response':
          {
            const p = api.promises[ evt.id ]
            delete api.promises[ evt.id ]
            if ( evt.error ) {
              p.reject( evt.error )
            } else {
              // console.log( evt )
              // console.log( 'promise content: ' + evt.content )
              p.resolve( evt.content )
            }
          }
          break

        default:
          api.emit( evt.type, evt.content )
      }
    }
  }

  return api
}

function onData ( api, chunk ) {
  api.buffer += chunk

  const lines = api.buffer.split( '\n' )
  api.buffer = lines.pop() // last line is not ready
  for ( let i = 0; i < lines.length; i++ ) {
    const line = lines[ i ]
    if ( line.indexOf( 'stdio-ipc: ' ) === 0 ) {
      api.parseMessage( line.slice( 'stdio-ipc: '.length ) )
    } else {
      api.emit( 'log', line )
    }
  }
}

function send ( api, json ) {
  const jsonString = JSON.stringify( json )
  api.stdwrite.write( 'stdio-ipc: ' + jsonString  + '\n' )
}

function promise ( api, json ) {
  return new Promise( function ( resolve, reject ) {
    const evt = {
      type: 'promise',
      id: api.ids++,
      content: json
    }

    const p = {
      id: evt.id,
      time: Date.now(),
      resolve: resolve,
      reject: reject
    }
    api.promises[ p.id ] = p

    const jsonString = JSON.stringify( evt )
    api.stdwrite.write( 'stdio-ipc: ' + jsonString  + '\n' )
  } )
}

function encodeArg ( arg )
{
  const type = typeof arg
  let content
  if ( type === 'object' || type === 'boolean' ) {
    content = JSON.stringify( arg )
  } else if ( type === 'string' ) {
    content = arg
  } else if ( type === 'number' ) {
    content = arg
  } else if ( type === 'function' ) {
    content = JSON.stringify(
      functionToString( arg )
    )
  }

  return {
    type: type,
    content: content
  }
}
