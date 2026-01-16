import React, { useState, useEffect, useCallback } from 'react';
import { View, Alert, FlatList, ScrollView } from 'react-native';
import { styles } from '../theme/appStyles';
import { IconButton, Text, Portal, Modal, Button, Divider, TextInput, FAB, Avatar, List } from 'react-native-paper';
import { auth, dbRealtime, storage } from '../configs/firebaseConfig';
import { signOut, updateProfile } from 'firebase/auth';
import { NewCommentComponent } from '../components/NewCommentComponents';
import { Comment, CommentComponent } from '../components/CommentComponents';
import { onValue, ref, push, set, query, limitToLast } from 'firebase/database';
import * as ImagePicker from 'expo-image-picker';
import { ref as refStorage, uploadBytes, getDownloadURL } from 'firebase/storage';
import { CommonActions, useNavigation } from '@react-navigation/native';

// Configuracion constante del juego (tamaño y posiciones iniciales)
const GRID_SIZE = 15; 
const INITIAL_SNAKE = [{ x: 7, y: 7 }]; 
const INITIAL_FOOD = { x: 5, y: 5 };   

export const JuegoScreen = () => {
  // Estados de aplicacion
  interface User { name: string; photo: string; }
  const [comments, setComments] = useState<Comment[]>([]); 
  const [scores, setScores] = useState<any[]>([]);     
  const [showAllComments, setShowAllComments] = useState<boolean>(false); 
  const [showModalComment, setShowModalComment] = useState<boolean>(false); 
  const [showModal, setShowModal] = useState<boolean>(false); 
  const [userAuth, setUserAuth] = useState<any>(null); 
  const [user, setUser] = useState<User>({ name: "", photo: "" });
  const navigation = useNavigation();

  //Estados del juego
  const [snake, setSnake] = useState(INITIAL_SNAKE); 
  const [food, setFood] = useState(INITIAL_FOOD);   
  const [direction, setDirection] = useState({ x: 0, y: -1 }); 
  const [isGameOver, setIsGameOver] = useState(false);
  const [score, setScore] = useState(0); 

  //logica de usuario y perfil

  // Funcion para cerrar sesion de Firebase y limpiar la navegacion
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setShowModal(false);
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'Login' }], 
        })
      );
    } catch (error) {
      Alert.alert("Error", "No se pudo cerrar la sesión correctamente.");
    }
  };

  // Funcion para reiniciar los valores del juego
  const handleRestart = () => {
    setScore(0);
    setSnake(INITIAL_SNAKE);
    setDirection({ x: 0, y: -1 });
    setIsGameOver(false);
  };

  // Guarda el puntaje en Firebase Realtime Database bajo el ID del usuario
  const saveScore = async (finalScore: number) => {
    if (finalScore === 0 || !userAuth?.uid) return;
    const scoreRef = ref(dbRealtime, `scores/${userAuth.uid}`);
    const newScoreRef = push(scoreRef); 
    await set(newScoreRef, {
      key: newScoreRef.key,
      points: finalScore,
      date: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString()
    });
  };

  // Logica del juego: Movimiento de la serpiente

  const moveSnake = useCallback(() => {
    if (isGameOver) return;

    setSnake((prevSnake) => {
      const head = prevSnake[0];
      const newHead = {
        x: (head.x + direction.x + GRID_SIZE) % GRID_SIZE,
        y: (head.y + direction.y + GRID_SIZE) % GRID_SIZE,
      };
      if (prevSnake.some(segment => segment.x === newHead.x && segment.y === newHead.y)) {
        setIsGameOver(true);
        saveScore(score);
        Alert.alert("¡PERDISTE!", `Puntaje: ${score}`, [{ text: "Reintentar", onPress: handleRestart }]);
        return prevSnake;
      }

      const newSnake = [newHead, ...prevSnake];

      // Logica de alimentacion
      if (newHead.x === food.x && newHead.y === food.y) {
        setScore(s => s + 1);
        setFood({ 
          x: Math.floor(Math.random() * GRID_SIZE), 
          y: Math.floor(Math.random() * GRID_SIZE) 
        });
      } else {
        newSnake.pop();
      }
      return newSnake;
    });
  }, [direction, food, isGameOver, score]);

  useEffect(() => {
    const interval = setInterval(moveSnake, 180);
    return () => clearInterval(interval); 
  }, [moveSnake]);

  //Sincrionizacion con Firebase

  // Obtener datos del usuario logueado al cargar
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      setUserAuth(currentUser);
      setUser({ name: currentUser.displayName || "", photo: currentUser.photoURL || "" });
    }
  }, []);

  //comentarios en tiempo real desde Firebase
  useEffect(() => {
    if (showAllComments) {
      const dbRef = ref(dbRealtime, 'comments');
      const unsubscribe = onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) { setComments([]); return; }
        const list: Comment[] = Object.keys(data).map((key) => ({ id: key, ...data[key] }));
        setComments(list);
      });
      return () => unsubscribe();
    }
  }, [showAllComments]);

  //ultimos 5 puntajes del usuario para el historial
  useEffect(() => {
    if (showModal && userAuth?.uid) {
      const scoreRef = query(ref(dbRealtime, `scores/${userAuth.uid}`), limitToLast(5));
      const unsubscribe = onValue(scoreRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list = Object.keys(data).map(key => ({ key, ...data[key] })).reverse();
          setScores(list);
        }
      });
      return () => unsubscribe();
    }
  }, [showModal, userAuth]);

  // Funciones para seleccionar o tomar foto usando ImagePicker

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({ 
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5 
    });
    if (!result.canceled) setUser({ ...user, photo: result.assets[0].uri });
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return;
    let result = await ImagePicker.launchCameraAsync({ 
      allowsEditing: true, aspect: [1, 1], quality: 0.5 
    });
    if (!result.canceled) setUser({ ...user, photo: result.assets[0].uri });
  };

  // Sube la imagen a Storage
  const handleUpdateUser = async () => {
    let photoURL = userAuth?.photoURL;
    if (user.photo && user.photo !== userAuth?.photoURL) {
      const response = await fetch(user.photo);
      const blob = await response.blob();
      const fileRef = refStorage(storage, `avatar/${userAuth?.uid}`);
      await uploadBytes(fileRef, blob);
      photoURL = await getDownloadURL(fileRef);
    }
    await updateProfile(userAuth!, { displayName: user.name, photoURL: photoURL });
    setShowModal(false);
    Alert.alert('Perfil', 'Actualizado correctamente');
  };

  return (
    <>
      <View style={styles.container}>
        <View style={styles.headerHome}>
          {userAuth?.photoURL ? <Avatar.Image size={60} source={{ uri: userAuth.photoURL }} /> : <Avatar.Text size={60} label="U" />}
          <View>
            <Text variant='bodySmall'>Bienvenido</Text>
            <Text variant="labelLarge">{userAuth?.displayName || "Usuario"}</Text>
          </View>
          <IconButton icon="account-cog" size={40} mode="contained" onPress={() => setShowModal(true)} />
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ backgroundColor: '#f0f0f0', padding: 15, borderRadius: 20, elevation: 4 }}>
            <Text variant="titleLarge" style={{ textAlign: 'center', color: '#2E7D32', marginBottom: 10, fontWeight: 'bold' }}>
               Score: {score}
            </Text>
            <View style={{ width: 300, height: 300, backgroundColor: '#111', borderRadius: 10, overflow: 'hidden', borderWidth: 5, borderColor: '#4CAF50' }}>

                {snake.map((seg, i) => (
                  <View 
                    key={`snake-${i}`}
                    style={{
                      position: 'absolute', 
                      width: 300/GRID_SIZE, 
                      height: 300/GRID_SIZE,
                      backgroundColor: i === 0 ? '#2E7D32' : '#8BC34A', 
                      left: (seg.x*300)/GRID_SIZE, 
                      top: (seg.y*300)/GRID_SIZE,
                      borderRadius: 4, 
                      zIndex: i === 0 ? 10 : 1
                    }}
                  >
                    {i === 0 && (
                      <View style={{ flexDirection: direction.y !== 0 ? 'row' : 'column', justifyContent: 'space-around', width: '80%', marginTop: 2 }}>
                        <View style={{ width: 4, height: 4, backgroundColor: 'white', borderRadius: 2 }} />
                        <View style={{ width: 4, height: 4, backgroundColor: 'white', borderRadius: 2 }} />
                      </View>
                    )}
                  </View>
                ))}
                <View style={{ position: 'absolute', width: 300/GRID_SIZE, height: 300/GRID_SIZE, backgroundColor: '#FF5252', left: (food.x*300)/GRID_SIZE, top: (food.y*300)/GRID_SIZE, borderRadius: 10 }} />
            </View>
          </View>

          {isGameOver && <Button mode="contained" onPress={handleRestart} style={{ marginTop: 15 }} buttonColor="#FF5252">Reintentar</Button>}
          
          {/*Botones de dirección */}
          <View style={{ marginTop: 20 }}>
            <IconButton icon="chevron-up" size={60} mode="contained" onPress={() => !isGameOver && setDirection({ x: 0, y: -1 })} style={{ alignSelf: 'center' }} />
            <View style={{ flexDirection: 'row' }}>
              <IconButton icon="chevron-left" size={60} mode="contained" onPress={() => !isGameOver && setDirection({ x: -1, y: 0 })} style={{ marginHorizontal: 15 }} />
              <IconButton icon="chevron-down" size={60} mode="contained" onPress={() => !isGameOver && setDirection({ x: 0, y: 1 })} />
              <IconButton icon="chevron-right" size={60} mode="contained" onPress={() => !isGameOver && setDirection({ x: 1, y: 0 })} style={{ marginHorizontal: 15 }} />
            </View>
          </View>
        </View>

        {/*Perfil e Historial */}
        <Portal>
          <Modal visible={showModal} onDismiss={() => setShowModal(false)} contentContainerStyle={[styles.modalContainer, { maxHeight: '85%' }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.headerModal}>
                <Text variant="headlineMedium">Mi Perfil</Text>
                <IconButton icon="close" onPress={() => setShowModal(false)} />
              </View>
              <Divider bold />
              {/* Fotos */}
              <View style={styles.containerImage}>
                {user.photo ? <Avatar.Image size={100} source={{ uri: user.photo }} /> : <Avatar.Icon size={100} icon="account" />}
                <View style={styles.containerIcons}>
                    <IconButton icon="image-album" mode="contained" onPress={pickImage} />
                    <IconButton icon="camera" mode="contained" onPress={takePhoto} />
                </View>
              </View>
              <TextInput label="Nombre" mode="outlined" value={user.name} onChangeText={(v) => setUser({...user, name: v})} style={styles.inputModal} />
              <TextInput label="Email" mode='outlined' value={userAuth?.email || ""} disabled style={{ marginBottom: 15 }} />
              
              <Divider />
              <Text variant="titleMedium" style={{ marginTop: 15, color: '#2E7D32' }}>🏆 Historial (Últimos 5)</Text>
              {scores.map((s) => (
                <List.Item 
                  key={s.key}
                  title={`${s.points} Puntos`} 
                  description={s.date} 
                  left={p => <List.Icon {...p} icon="medal" color="#FFD700" />} 
                />
              ))}

              <Button mode="contained" onPress={handleUpdateUser} style={styles.saveButton}>Actualizar Datos</Button>
              
              <Button 
                mode="outlined" 
                icon="logout" 
                onPress={handleSignOut} 
                textColor="#D32F2F"
                style={{ marginTop: 15, borderColor: '#D32F2F' }}
              >
                Cerrar Sesión
              </Button>
            </ScrollView>
          </Modal>
        </Portal>

        {/*comentarios de otros usuarios */}
        <Portal>
          <Modal 
            visible={showAllComments} 
            onDismiss={() => setShowAllComments(false)} 
            contentContainerStyle={[styles.modalComments, { maxHeight: '80%', marginHorizontal: 20 }]}
          >
            <View style={styles.headerModal}>
                <Text variant="headlineSmall" style={{ fontWeight: 'bold' }}>Comentarios</Text>
              <IconButton icon="close" onPress={() => setShowAllComments(false)} />
            </View>
            <Divider bold={true} />
            {/* Lista de comentarios */}
           <FlatList
              data={comments}
              renderItem={({ item }) => <CommentComponent comment={item} />}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 16 }}
              showsVerticalScrollIndicator={false}
            />
          </Modal>
        </Portal>
      </View>

      {/* Botones de comentarios */}
      <FAB 
        icon="comment-eye" 
        style={[styles.fab, { bottom: 20 }]} 
        onPress={() => setShowAllComments(true)} 
      />
      <FAB 
        icon="comment-edit" 
        style={[styles.fab2, { bottom: 20 }]} 
        onPress={() => setShowModalComment(true)} 
      />
      <NewCommentComponent visible={showModalComment} hideModal={() => setShowModalComment(false)} />
    </>
  );
};