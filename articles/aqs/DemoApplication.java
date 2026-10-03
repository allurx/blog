package io.allurx;


/**
 * @author allurx
 */
public class DemoApplication {

    private static int n = 0;

    private static Mutex mutex = new Mutex();

    public static void main(String[] args) throws InterruptedException {
        Thread t1 = new Thread(new Worker());
        Thread t2 = new Thread(new Worker());
        Thread t3 = new Thread(new Worker());
        t1.start();
        t2.start();
        t3.start();
        t1.join();
        t2.join();
        t3.join();
        System.out.println(n);
    }

    static class Worker implements Runnable {

        @Override
        public void run() {
            for (int i = 0; i < 100000; i++) {
                mutex.lock();
                try {
                    n++;
                } finally {
                    mutex.unlock();
                }
            }
        }
    }

}
